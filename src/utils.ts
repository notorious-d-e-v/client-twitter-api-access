import type { Tweet } from "agent-twitter-client";
import { getEmbeddingZeroVector } from "@elizaos/core";
import type { Content, Memory, UUID } from "@elizaos/core";
import { stringToUuid } from "@elizaos/core";
import type { ClientBase } from "./base";
import { elizaLogger } from "@elizaos/core";
import type { Media } from "@elizaos/core";
import fs from "fs";
import path from "path";
import { ElizaTweet, MediaData } from "./types";
import { SendTweetV2Params, TweetV2, TweetV2PostTweetResult } from "twitter-api-v2";
import { TwitterV2IncludesHelper } from "twitter-api-v2";

export const wait = (minTime = 1000, maxTime = 3000) => {
    const waitTime =
        Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
    return new Promise((resolve) => setTimeout(resolve, waitTime));
};

export const isValidTweet = (tweet: Tweet): boolean => {
    // Filter out tweets with too many hashtags, @s, or $ signs, probably spam or garbage
    const hashtagCount = (tweet.text?.match(/#/g) || []).length;
    const atCount = (tweet.text?.match(/@/g) || []).length;
    const dollarSignCount = (tweet.text?.match(/\$/g) || []).length;
    const totalCount = hashtagCount + atCount + dollarSignCount;

    return (
        hashtagCount <= 1 &&
        atCount <= 2 &&
        dollarSignCount <= 1 &&
        totalCount <= 3
    );
};

export async function buildConversationThread(
    tweet: ElizaTweet,
    client: ClientBase,
    maxReplies = 10
): Promise<ElizaTweet[]> {
    const thread: ElizaTweet[] = [];
    const visited: Set<string> = new Set();

    async function processThread(currentTweet: ElizaTweet, depth = 0) {
        elizaLogger.debug("Processing tweet:", {
            id: currentTweet.id,
            inReplyToStatusId: currentTweet.inReplyToStatusId,
            depth: depth,
        });

        if (!currentTweet) {
            elizaLogger.debug("No current tweet found for thread building");
            return;
        }

        // Stop if we've reached our reply limit
        if (depth >= maxReplies) {
            elizaLogger.debug("Reached maximum reply depth", depth);
            return;
        }

        // Handle memory storage
        const memory = await client.runtime.messageManager.getMemoryById(
            stringToUuid(currentTweet.id + "-" + client.runtime.agentId)
        );
        if (!memory) {
            const roomId = stringToUuid(
                currentTweet.conversationId + "-" + client.runtime.agentId
            );
            const userId = stringToUuid(currentTweet.authorId);

            await client.runtime.ensureConnection(
                userId,
                roomId,
                currentTweet.authorUsername,
                currentTweet.authorName,
                "twitter"
            );

            await client.runtime.messageManager.createMemory({
                id: stringToUuid(
                    currentTweet.id + "-" + client.runtime.agentId
                ),
                agentId: client.runtime.agentId,
                content: {
                    text: currentTweet.text,
                    source: "twitter",
                    url: currentTweet.permanentUrl,
                    imageUrls: currentTweet.photos.map((p) => p.url) || [],
                    inReplyTo: currentTweet.inReplyToStatusId
                        ? stringToUuid(
                              currentTweet.inReplyToStatusId +
                                  "-" +
                                  client.runtime.agentId
                          )
                        : undefined,
                },
                createdAt: currentTweet.timestamp * 1000,
                roomId,
                userId:
                    currentTweet.authorId === client.profile.id
                        ? client.runtime.agentId
                        : stringToUuid(currentTweet.authorId),
                embedding: getEmbeddingZeroVector(),
            });
        }

        if (visited.has(currentTweet.id)) {
            elizaLogger.debug("Already visited tweet:", currentTweet.id);
            return;
        }

        visited.add(currentTweet.id);
        thread.unshift(currentTweet);

        elizaLogger.debug("Current thread state:", {
            length: thread.length,
            currentDepth: depth,
            tweetId: currentTweet.id,
        });

        // If there's a parent tweet, fetch and process it
        if (currentTweet.inReplyToStatusId) {
            elizaLogger.debug(
                "Fetching parent tweet:",
                currentTweet.inReplyToStatusId
            );
            try {
                const parentTweetResult = await client.requestQueue.add(async () => {
                    return await client.twitterClient.v2.singleTweet(currentTweet.inReplyToStatusId, {
                        "tweet.fields": "created_at,author_id,conversation_id,entities,referenced_tweets,text",
                        "expansions": "author_id,referenced_tweets.id"
                    })
                });
                const parentTweet = createElizaTweet(parentTweetResult.data, new TwitterV2IncludesHelper(parentTweetResult));

                if (parentTweet) {
                    elizaLogger.debug("Found parent tweet:", {
                        id: parentTweet.id,
                        text: parentTweet.text?.slice(0, 50),
                    });
                    await processThread(parentTweet, depth + 1);
                } else {
                    elizaLogger.debug(
                        "No parent tweet found for:",
                        currentTweet.inReplyToStatusId
                    );
                }
            } catch (error) {
                elizaLogger.error("Error fetching parent tweet:", {
                    tweetId: currentTweet.inReplyToStatusId,
                    error,
                });
            }
        } else {
            elizaLogger.debug(
                "Reached end of reply chain at:",
                currentTweet.id
            );
        }
    }

    await processThread(tweet, 0);

    elizaLogger.debug("Final thread built:", {
        totalTweets: thread.length,
        tweetIds: thread.map((t) => ({
            id: t.id,
            text: t.text?.slice(0, 50),
        })),
    });

    return thread;
}

export async function fetchMediaData(
    attachments: Media[]
): Promise<MediaData[]> {
    return Promise.all(
        attachments.map(async (attachment: Media) => {
            if (/^(http|https):\/\//.test(attachment.url)) {
                // Handle HTTP URLs
                const response = await fetch(attachment.url);
                if (!response.ok) {
                    throw new Error(`Failed to fetch file: ${attachment.url}`);
                }
                const mediaBuffer = Buffer.from(await response.arrayBuffer());
                const mediaType = attachment.contentType;
                return { data: mediaBuffer, mediaType };
            } else if (fs.existsSync(attachment.url)) {
                // Handle local file paths
                const mediaBuffer = await fs.promises.readFile(
                    path.resolve(attachment.url)
                );
                const mediaType = attachment.contentType;
                return { data: mediaBuffer, mediaType };
            } else {
                throw new Error(
                    `File not found: ${attachment.url}. Make sure the path is correct.`
                );
            }
        })
    );
}

export async function sendTweet(
    client: ClientBase,
    content: Content,
    roomId: UUID,
    inReplyTo: string
): Promise<Memory[]> {
    const maxTweetLength = client.twitterConfig.MAX_TWEET_LENGTH;

    const tweetChunks = splitTweetContent(content.text, maxTweetLength);
    const sentTweets: Tweet[] = [];
    let previousTweetId = inReplyTo;

    for (const chunk of tweetChunks) {
        let mediaData = null;

        if (content.attachments && content.attachments.length > 0) {
            mediaData = await fetchMediaData(content.attachments);
        }

        const cleanChunk = deduplicateMentions(chunk.trim());

        const tweetData: SendTweetV2Params = {
            text: cleanChunk,
            reply: {
                in_reply_to_tweet_id: previousTweetId
            }
        };

        if (mediaData) {
            // Upload media and get media IDs
            const mediaIds = await Promise.all(
                mediaData.map(async (media) => {
                    const mediaId = await client.twitterClient.v2.uploadMedia(
                        media.data,
                        { media_type: media.mediaType }
                    );
                    return mediaId;
                })
            );
            tweetData.media = { media_ids: mediaIds as [string, string, string, string] };
        }

        const result = await client.requestQueue.add(async () =>
            client.twitterClient.v2.tweet(tweetData)
        );

        // fetch the tweet that was just posted
        const tweetResult = await client.requestQueue.add(async () =>
            client.twitterClient.v2.singleTweet(result.data.id, {
                "tweet.fields": "created_at,author_id,conversation_id,entities,referenced_tweets,text",
                "expansions": "author_id"
            })
        );

        const finalTweet = createElizaTweet(tweetResult.data, new TwitterV2IncludesHelper(tweetResult));

        sentTweets.push(finalTweet);
        previousTweetId = finalTweet.id;
    }

    const memories: Memory[] = sentTweets.map((tweet) => ({
        id: stringToUuid(`${tweet.id}-${client.runtime.agentId}`),
        agentId: client.runtime.agentId,
        userId: client.runtime.agentId,
        content: {
            tweetId: tweet.id,
            text: tweet.text,
            source: "twitter",
            url: tweet.permanentUrl,
            imageUrls: tweet.photos.map((p) => p.url) || [],
            inReplyTo: tweet.inReplyToStatusId
                ? stringToUuid(
                      tweet.inReplyToStatusId + "-" + client.runtime.agentId
                  )
                : undefined,
        },
        roomId,
        embedding: getEmbeddingZeroVector(),
        createdAt: tweet.timestamp * 1000, 
    }));

    return memories;
}

function splitTweetContent(content: string, maxLength: number): string[] {
    const paragraphs = content.split("\n\n").map((p) => p.trim());
    const tweets: string[] = [];
    let currentTweet = "";

    for (const paragraph of paragraphs) {
        if (!paragraph) continue;

        if ((currentTweet + "\n\n" + paragraph).trim().length <= maxLength) {
            if (currentTweet) {
                currentTweet += "\n\n" + paragraph;
            } else {
                currentTweet = paragraph;
            }
        } else {
            if (currentTweet) {
                tweets.push(currentTweet.trim());
            }
            if (paragraph.length <= maxLength) {
                currentTweet = paragraph;
            } else {
                // Split long paragraph into smaller chunks
                const chunks = splitParagraph(paragraph, maxLength);
                tweets.push(...chunks.slice(0, -1));
                currentTweet = chunks[chunks.length - 1];
            }
        }
    }

    if (currentTweet) {
        tweets.push(currentTweet.trim());
    }

    return tweets;
}

function extractUrls(paragraph: string): {
    textWithPlaceholders: string;
    placeholderMap: Map<string, string>;
} {
    // replace https urls with placeholder
    const urlRegex = /https?:\/\/[^\s]+/g;
    const placeholderMap = new Map<string, string>();

    let urlIndex = 0;
    const textWithPlaceholders = paragraph.replace(urlRegex, (match) => {
        // twitter url would be considered as 23 characters
        // <<URL_CONSIDERER_23_1>> is also 23 characters
        const placeholder = `<<URL_CONSIDERER_23_${urlIndex}>>`; // Placeholder without . ? ! etc
        placeholderMap.set(placeholder, match);
        urlIndex++;
        return placeholder;
    });

    return { textWithPlaceholders, placeholderMap };
}

function splitSentencesAndWords(text: string, maxLength: number): string[] {
    // Split by periods, question marks and exclamation marks
    // Note that URLs in text have been replaced with `<<URL_xxx>>` and won't be split by dots
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const chunks: string[] = [];
    let currentChunk = "";

    for (const sentence of sentences) {
        if ((currentChunk + " " + sentence).trim().length <= maxLength) {
            if (currentChunk) {
                currentChunk += " " + sentence;
            } else {
                currentChunk = sentence;
            }
        } else {
            // Can't fit more, push currentChunk to results
            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }

            // If current sentence itself is less than or equal to maxLength
            if (sentence.length <= maxLength) {
                currentChunk = sentence;
            } else {
                // Need to split sentence by spaces
                const words = sentence.split(" ");
                currentChunk = "";
                for (const word of words) {
                    if (
                        (currentChunk + " " + word).trim().length <= maxLength
                    ) {
                        if (currentChunk) {
                            currentChunk += " " + word;
                        } else {
                            currentChunk = word;
                        }
                    } else {
                        if (currentChunk) {
                            chunks.push(currentChunk.trim());
                        }
                        currentChunk = word;
                    }
                }
            }
        }
    }

    // Handle remaining content
    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

function deduplicateMentions(paragraph: string) {
    // Regex to match mentions at the beginning of the string
  const mentionRegex = /^@(\w+)(?:\s+@(\w+))*(\s+|$)/;

  // Find all matches
  const matches = paragraph.match(mentionRegex);

  if (!matches) {
    return paragraph; // If no matches, return the original string
  }

  // Extract mentions from the match groups
  let mentions = matches.slice(0, 1)[0].trim().split(' ')

  // Deduplicate mentions
  mentions = [...new Set(mentions)];

  // Reconstruct the string with deduplicated mentions
  const uniqueMentionsString = mentions.join(' ');

  // Find where the mentions end in the original string
  const endOfMentions = paragraph.indexOf(matches[0]) + matches[0].length;

  // Construct the result by combining unique mentions with the rest of the string
  return uniqueMentionsString + ' ' + paragraph.slice(endOfMentions);
}

function restoreUrls(
    chunks: string[],
    placeholderMap: Map<string, string>
): string[] {
    return chunks.map((chunk) => {
        // Replace all <<URL_CONSIDERER_23_>> in chunk back to original URLs using regex
        return chunk.replace(/<<URL_CONSIDERER_23_(\d+)>>/g, (match) => {
            const original = placeholderMap.get(match);
            return original || match; // Return placeholder if not found (theoretically won't happen)
        });
    });
}

function splitParagraph(paragraph: string, maxLength: number): string[] {
    // 1) Extract URLs and replace with placeholders
    const { textWithPlaceholders, placeholderMap } = extractUrls(paragraph);

    // 2) Use first section's logic to split by sentences first, then do secondary split
    const splittedChunks = splitSentencesAndWords(
        textWithPlaceholders,
        maxLength
    );

    // 3) Replace placeholders back to original URLs
    const restoredChunks = restoreUrls(splittedChunks, placeholderMap);

    return restoredChunks;
}

export function createElizaTweet(fetchedTweetResult: TweetV2, includes: TwitterV2IncludesHelper): ElizaTweet {
    if (!fetchedTweetResult) {
        return null;
    }

    // get the author
    const author = includes.author(fetchedTweetResult);

    // get the replied to tweet id
    let repliedToId = null;
    if (fetchedTweetResult.referenced_tweets && fetchedTweetResult.referenced_tweets.length > 0) {
        for (const referencedTweet of fetchedTweetResult.referenced_tweets) {
            if (referencedTweet.type === "replied_to") {
                repliedToId = referencedTweet.id;
            }
        }
    }

    // create the tweet
    const tweet: ElizaTweet = {
        id: fetchedTweetResult.id,
        text: fetchedTweetResult.text,
        conversationId: fetchedTweetResult.conversation_id,
        timestamp: fetchedTweetResult.created_at ? new Date(fetchedTweetResult.created_at).getTime() : null,
        authorId: author.id,
        authorName: author.name,
        authorUsername: author.username,
        photos: [],
        thread: [],
        videos: [],
        mentions: fetchedTweetResult.entities?.mentions?.map((mention) => mention.username) || [],
        permanentUrl: `https://x.com/${author.username}/status/${fetchedTweetResult.id}`,
        inReplyToStatusId: repliedToId,
        isReply: !!repliedToId,
        isRetweet: false,
    }
    
    return tweet;
}