// src/client.ts
import { elizaLogger as elizaLogger5 } from "@elizaos/core";

// src/base.ts
import {
  getEmbeddingZeroVector as getEmbeddingZeroVector2,
  elizaLogger as elizaLogger2,
  stringToUuid as stringToUuid2
} from "@elizaos/core";
import {
  TwitterApi,
  TwitterV2IncludesHelper as TwitterV2IncludesHelper2
} from "twitter-api-v2";
import { EventEmitter } from "events";

// src/utils.ts
import { getEmbeddingZeroVector } from "@elizaos/core";
import { stringToUuid } from "@elizaos/core";
import { elizaLogger } from "@elizaos/core";
import fs from "fs";
import path from "path";
import { TwitterV2IncludesHelper } from "twitter-api-v2";
var wait = (minTime = 1e3, maxTime = 3e3) => {
  const waitTime = Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
  return new Promise((resolve) => setTimeout(resolve, waitTime));
};
async function buildConversationThread(tweet, client, maxReplies = 10) {
  const thread = [];
  const conversationTweets = [];
  elizaLogger.debug("Building conversation thread for tweet:");
  console.dir(tweet, { depth: null });
  try {
    const query = `conversation_id:${tweet.conversationId}`;
    const searchResult = await client.twitterClient.v2.search(query, {
      "tweet.fields": "created_at,author_id,conversation_id,entities,referenced_tweets,text",
      "expansions": "author_id,referenced_tweets.id",
      max_results: 100
    });
    const tweets = searchResult.data.data;
    const includesHelper = new TwitterV2IncludesHelper(searchResult);
    tweets.sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const tweetData of tweets) {
      const elizaTweet = createElizaTweet(tweetData, includesHelper);
      if (!elizaTweet) {
        continue;
      }
      conversationTweets.push(elizaTweet);
    }
    const tweetsById = /* @__PURE__ */ new Map();
    for (const tweet2 of conversationTweets) {
      tweetsById.set(tweet2.id, tweet2);
    }
    const replyChain = [tweet];
    let currentTweet = tweet;
    while (currentTweet && currentTweet.inReplyToStatusId) {
      const parentTweet = tweetsById.get(currentTweet.inReplyToStatusId);
      if (parentTweet) {
        replyChain.push(parentTweet);
      }
      currentTweet = parentTweet;
    }
    replyChain.reverse();
    elizaLogger.log("replyChain: ", replyChain);
    for (const elizaTweet of replyChain) {
      const memory = await client.runtime.messageManager.getMemoryById(
        stringToUuid(elizaTweet.id + "-" + client.runtime.agentId)
      );
      if (!memory) {
        const roomId = stringToUuid(
          elizaTweet.conversationId + "-" + client.runtime.agentId
        );
        const userId = stringToUuid(elizaTweet.authorId);
        await client.runtime.ensureConnection(
          userId,
          roomId,
          elizaTweet.authorUsername,
          elizaTweet.authorName,
          "twitter"
        );
        await client.runtime.messageManager.createMemory({
          id: stringToUuid(
            elizaTweet.id + "-" + client.runtime.agentId
          ),
          agentId: client.runtime.agentId,
          content: {
            text: elizaTweet.text,
            source: "twitter",
            url: elizaTweet.permanentUrl,
            imageUrls: elizaTweet.photos.map((p) => p.url) || [],
            inReplyTo: elizaTweet.inReplyToStatusId ? stringToUuid(
              elizaTweet.inReplyToStatusId + "-" + client.runtime.agentId
            ) : void 0
          },
          createdAt: elizaTweet.timestamp,
          roomId,
          userId: elizaTweet.authorId === client.profile.id ? client.runtime.agentId : stringToUuid(elizaTweet.authorId),
          embedding: getEmbeddingZeroVector()
        });
      }
    }
    return replyChain;
  } catch (error) {
    elizaLogger.error("Error fetching conversation tweets:", {
      conversationId: tweet.conversationId,
      error
    });
  }
}
async function fetchMediaData(attachments) {
  return Promise.all(
    attachments.map(async (attachment) => {
      if (/^(http|https):\/\//.test(attachment.url)) {
        const response = await fetch(attachment.url);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${attachment.url}`);
        }
        const mediaBuffer = Buffer.from(await response.arrayBuffer());
        const mediaType = attachment.contentType;
        return { data: mediaBuffer, mediaType };
      } else if (fs.existsSync(attachment.url)) {
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
async function sendTweet(client, content, roomId, inReplyTo) {
  const maxTweetLength = client.twitterConfig.MAX_TWEET_LENGTH;
  const tweetChunks = splitTweetContent(content.text, maxTweetLength);
  const sentTweets = [];
  let previousTweetId = inReplyTo;
  for (const chunk of tweetChunks) {
    let mediaData = null;
    if (content.attachments && content.attachments.length > 0) {
      mediaData = await fetchMediaData(content.attachments);
    }
    const cleanChunk = deduplicateMentions(chunk.trim());
    const tweetData = {
      text: cleanChunk,
      reply: {
        in_reply_to_tweet_id: previousTweetId
      }
    };
    if (mediaData) {
      const mediaIds = await Promise.all(
        mediaData.map(async (media) => {
          const mediaId = await client.twitterClient.v2.uploadMedia(
            media.data,
            { media_type: media.mediaType }
          );
          return mediaId;
        })
      );
      tweetData.media = { media_ids: mediaIds };
    }
    const result = await client.requestQueue.add(
      async () => client.twitterClient.v2.tweet(tweetData)
    );
    const tweetResult = await client.requestQueue.add(
      async () => client.twitterClient.v2.singleTweet(result.data.id, {
        "tweet.fields": "created_at,author_id,conversation_id,entities,referenced_tweets,text",
        "expansions": "author_id"
      })
    );
    const finalTweet = createElizaTweet(tweetResult.data, new TwitterV2IncludesHelper(tweetResult));
    sentTweets.push(finalTweet);
    previousTweetId = finalTweet.id;
  }
  const memories = sentTweets.map((tweet) => ({
    id: stringToUuid(`${tweet.id}-${client.runtime.agentId}`),
    agentId: client.runtime.agentId,
    userId: client.runtime.agentId,
    content: {
      tweetId: tweet.id,
      text: tweet.text,
      source: "twitter",
      url: tweet.permanentUrl,
      imageUrls: tweet.photos.map((p) => p.url) || [],
      inReplyTo: tweet.inReplyToStatusId ? stringToUuid(
        tweet.inReplyToStatusId + "-" + client.runtime.agentId
      ) : void 0
    },
    roomId,
    embedding: getEmbeddingZeroVector(),
    createdAt: tweet.timestamp * 1e3
  }));
  return memories;
}
function splitTweetContent(content, maxLength) {
  const paragraphs = content.split("\n\n").map((p) => p.trim());
  const tweets = [];
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
function extractUrls(paragraph) {
  const urlRegex = /https?:\/\/[^\s]+/g;
  const placeholderMap = /* @__PURE__ */ new Map();
  let urlIndex = 0;
  const textWithPlaceholders = paragraph.replace(urlRegex, (match) => {
    const placeholder = `<<URL_CONSIDERER_23_${urlIndex}>>`;
    placeholderMap.set(placeholder, match);
    urlIndex++;
    return placeholder;
  });
  return { textWithPlaceholders, placeholderMap };
}
function splitSentencesAndWords(text, maxLength) {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const chunks = [];
  let currentChunk = "";
  for (const sentence of sentences) {
    if ((currentChunk + " " + sentence).trim().length <= maxLength) {
      if (currentChunk) {
        currentChunk += " " + sentence;
      } else {
        currentChunk = sentence;
      }
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      if (sentence.length <= maxLength) {
        currentChunk = sentence;
      } else {
        const words = sentence.split(" ");
        currentChunk = "";
        for (const word of words) {
          if ((currentChunk + " " + word).trim().length <= maxLength) {
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
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}
function deduplicateMentions(paragraph) {
  const mentionRegex = /^@(\w+)(?:\s+@(\w+))*(\s+|$)/;
  const matches = paragraph.match(mentionRegex);
  if (!matches) {
    return paragraph;
  }
  let mentions = matches.slice(0, 1)[0].trim().split(" ");
  mentions = [...new Set(mentions)];
  const uniqueMentionsString = mentions.join(" ");
  const endOfMentions = paragraph.indexOf(matches[0]) + matches[0].length;
  return uniqueMentionsString + " " + paragraph.slice(endOfMentions);
}
function restoreUrls(chunks, placeholderMap) {
  return chunks.map((chunk) => {
    return chunk.replace(/<<URL_CONSIDERER_23_(\d+)>>/g, (match) => {
      const original = placeholderMap.get(match);
      return original || match;
    });
  });
}
function splitParagraph(paragraph, maxLength) {
  const { textWithPlaceholders, placeholderMap } = extractUrls(paragraph);
  const splittedChunks = splitSentencesAndWords(
    textWithPlaceholders,
    maxLength
  );
  const restoredChunks = restoreUrls(splittedChunks, placeholderMap);
  return restoredChunks;
}
function createElizaTweet(fetchedTweetResult, includes) {
  var _a, _b;
  if (!fetchedTweetResult) {
    return null;
  }
  const author = includes.author(fetchedTweetResult);
  let repliedToId = null;
  if (fetchedTweetResult.referenced_tweets && fetchedTweetResult.referenced_tweets.length > 0) {
    for (const referencedTweet of fetchedTweetResult.referenced_tweets) {
      if (referencedTweet.type === "replied_to") {
        repliedToId = referencedTweet.id;
      }
    }
  }
  const tweet = {
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
    mentions: ((_b = (_a = fetchedTweetResult.entities) == null ? void 0 : _a.mentions) == null ? void 0 : _b.map((mention) => mention.username)) || [],
    permanentUrl: `https://x.com/${author.username}/status/${fetchedTweetResult.id}`,
    inReplyToStatusId: repliedToId,
    isReply: !!repliedToId,
    isRetweet: false
  };
  return tweet;
}

// src/base.ts
var defaultProfile = {
  id: "",
  username: "",
  name: "",
  bio: "",
  nicknames: []
};
var RequestQueue = class {
  queue = [];
  processing = false;
  async add(request) {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await request();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }
  async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    this.processing = true;
    while (this.queue.length > 0) {
      const request = this.queue.shift();
      try {
        await request();
      } catch (error) {
        console.error("Error processing request:", error);
        this.queue.unshift(request);
        await this.exponentialBackoff(this.queue.length);
      }
      await this.randomDelay();
    }
    this.processing = false;
  }
  async exponentialBackoff(retryCount) {
    const delay = Math.pow(2, retryCount) * 1e3;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  async randomDelay() {
    const delay = Math.floor(Math.random() * 2e3) + 1500;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
};
var ClientBase = class extends EventEmitter {
  static _twitterClients = {};
  twitterClient;
  runtime;
  twitterConfig;
  directions;
  lastCheckedTweetId = null;
  imageDescriptionService;
  temperature = 0.5;
  requestQueue = new RequestQueue();
  profile;
  async cacheTweet(tweet) {
    if (!tweet) {
      console.warn("Tweet is undefined, skipping cache");
      return;
    }
    this.runtime.cacheManager.set(`twitter/tweets/${tweet.id}`, tweet);
  }
  async getCachedTweet(tweetId) {
    const cached = await this.runtime.cacheManager.get(
      `twitter/tweets/${tweetId}`
    );
    return cached;
  }
  async getTweet(tweetId) {
    const cachedTweet = await this.getCachedTweet(tweetId);
    if (cachedTweet) {
      return cachedTweet;
    }
    const tweet = await this.requestQueue.add(
      () => this.twitterClient.v2.singleTweet(tweetId, {
        "tweet.fields": "created_at,author_id,conversation_id,entities,referenced_tweets,text",
        "expansions": "author_id"
      })
    );
    const includes = new TwitterV2IncludesHelper2(tweet);
    const elizaTweet = createElizaTweet(tweet.data, includes);
    await this.cacheTweet(elizaTweet);
    return elizaTweet;
  }
  callback = null;
  onReady() {
    throw new Error(
      "Not implemented in base class, please call from subclass"
    );
  }
  /**
   * Parse the raw tweet data into a standardized Tweet object.
   */
  parseTweet(raw, depth = 0, maxDepth = 3) {
    var _a, _b;
    const canRecurse = depth < maxDepth;
    const quotedStatus = ((_a = raw.quoted_status_result) == null ? void 0 : _a.result) && canRecurse ? this.parseTweet(raw.quoted_status_result.result, depth + 1, maxDepth) : void 0;
    const retweetedStatus = ((_b = raw.retweeted_status_result) == null ? void 0 : _b.result) && canRecurse ? this.parseTweet(raw.retweeted_status_result.result, depth + 1, maxDepth) : void 0;
    const t = {
      id: "",
      text: "",
      edit_history_tweet_ids: []
    };
    return t;
  }
  constructor(runtime, twitterConfig) {
    super();
    this.runtime = runtime;
    this.twitterConfig = twitterConfig;
    this.profile = defaultProfile;
    this.twitterClient = new TwitterApi({
      appKey: this.twitterConfig.TWITTER_APP_KEY,
      appSecret: this.twitterConfig.TWITTER_APP_SECRET,
      accessToken: this.twitterConfig.TWITTER_ACCESS_TOKEN,
      accessSecret: this.twitterConfig.TWITTER_ACCESS_SECRET
    });
    elizaLogger2.info("Twitter client initialized with access token and access secret.");
    this.runtime.character.style.all.join("\n- ") + "- " + this.runtime.character.style.post.join();
  }
  async init() {
    this.profile = await this.fetchProfile();
    if (this.profile) {
      elizaLogger2.log("Twitter user ID:", this.profile.id);
      elizaLogger2.log(
        "Twitter loaded:",
        JSON.stringify(this.profile, null, 10)
      );
      this.runtime.character.twitterProfile = {
        id: this.profile.id,
        username: this.profile.username,
        name: this.profile.name,
        bio: this.profile.bio,
        nicknames: this.profile.nicknames
      };
    } else {
      throw new Error("Failed to load profile");
    }
  }
  async fetchOwnPosts(count) {
    elizaLogger2.debug("fetching own posts");
    return [];
  }
  /**
   * Fetch timeline for twitter account, optionally only from followed accounts
   */
  async fetchHomeTimeline(count, following) {
    elizaLogger2.debug("fetching home timeline");
    return [];
  }
  async fetchTimelineForActions(count) {
    elizaLogger2.debug("fetching timeline for actions");
    return [];
  }
  async fetchSearchTweets(query, maxTweets) {
    try {
      const result = await this.requestQueue.add(
        async () => {
          return await this.twitterClient.v2.search(query, {
            max_results: maxTweets,
            "tweet.fields": "created_at,author_id,conversation_id,entities,referenced_tweets,text",
            "expansions": "author_id"
          });
        }
      );
      const tweets = result.tweets.map((tweet) => createElizaTweet(tweet, result.includes));
      return { tweets };
    } catch (error) {
      elizaLogger2.error("Error fetching search tweets:", error);
      console.error(error);
      return { tweets: [] };
    }
  }
  async getMentions(userId, count, options) {
    elizaLogger2.debug("fetching mentions");
    const defaultFields = ["created_at", "author_id", "conversation_id", "entities", "referenced_tweets", "text"];
    const defaultExpansions = ["author_id"];
    const tweetFields = (options == null ? void 0 : options["tweet.fields"]) || defaultFields;
    const expansions = (options == null ? void 0 : options["expansions"]) || defaultExpansions;
    const mentions = await this.requestQueue.add(async () => {
      return await this.twitterClient.v2.userMentionTimeline(userId, {
        max_results: count,
        "tweet.fields": tweetFields.join(","),
        "expansions": expansions.join(",")
      });
    });
    return mentions.tweets.map((tweet) => createElizaTweet(tweet, mentions.includes));
  }
  async populateTimeline() {
    var _a;
    elizaLogger2.debug("populating timeline...");
    const cachedTimeline = await this.getCachedTimeline();
    if (cachedTimeline) {
      const existingMemories2 = await this.runtime.messageManager.getMemoriesByRoomIds({
        roomIds: cachedTimeline.map(
          (tweet) => stringToUuid2(
            tweet.conversationId + "-" + this.runtime.agentId
          )
        )
      });
      const existingMemoryIds2 = new Set(
        existingMemories2.map((memory) => memory.id.toString())
      );
      const someCachedTweetsExist = cachedTimeline.some(
        (tweet) => existingMemoryIds2.has(
          stringToUuid2(tweet.id + "-" + this.runtime.agentId)
        )
      );
      if (someCachedTweetsExist) {
        const tweetsToSave2 = cachedTimeline.filter(
          (tweet) => !existingMemoryIds2.has(
            stringToUuid2(tweet.id + "-" + this.runtime.agentId)
          )
        );
        console.log({
          processingTweets: tweetsToSave2.map((tweet) => tweet.id).join(",")
        });
        for (const tweet of tweetsToSave2) {
          elizaLogger2.log("Saving Tweet", tweet.id);
          const roomId = stringToUuid2(
            tweet.conversationId + "-" + this.runtime.agentId
          );
          const userId = tweet.userId === this.profile.id ? this.runtime.agentId : stringToUuid2(tweet.userId);
          if (tweet.userId === this.profile.id) {
            await this.runtime.ensureConnection(
              this.runtime.agentId,
              roomId,
              this.profile.username,
              this.profile.name,
              "twitter"
            );
          } else {
            await this.runtime.ensureConnection(
              userId,
              roomId,
              tweet.username,
              tweet.name,
              "twitter"
            );
          }
          const content = {
            text: tweet.text,
            url: tweet.permanentUrl,
            source: "twitter",
            inReplyTo: tweet.inReplyToStatusId ? stringToUuid2(
              tweet.inReplyToStatusId + "-" + this.runtime.agentId
            ) : void 0
          };
          elizaLogger2.log("Creating memory for tweet", tweet.id);
          const memory = await this.runtime.messageManager.getMemoryById(
            stringToUuid2(tweet.id + "-" + this.runtime.agentId)
          );
          if (memory) {
            elizaLogger2.log(
              "Memory already exists, skipping timeline population"
            );
            break;
          }
          await this.runtime.messageManager.createMemory({
            id: stringToUuid2(tweet.id + "-" + this.runtime.agentId),
            userId,
            content,
            agentId: this.runtime.agentId,
            roomId,
            embedding: getEmbeddingZeroVector2(),
            createdAt: tweet.timestamp * 1e3
          });
          await this.cacheTweet(tweet);
        }
        elizaLogger2.log(
          `Populated ${tweetsToSave2.length} missing tweets from the cache.`
        );
        return;
      }
    }
    const timeline = await this.fetchHomeTimeline(cachedTimeline ? 10 : 50);
    const username = (_a = this.profile) == null ? void 0 : _a.username;
    const mentionsAndInteractions = await this.fetchSearchTweets(
      `@${username}`,
      20
      // SearchMode.Latest
    );
    const allTweets = [...timeline, ...mentionsAndInteractions.tweets];
    const tweetIdsToCheck = /* @__PURE__ */ new Set();
    const roomIds = /* @__PURE__ */ new Set();
    for (const tweet of allTweets) {
      tweetIdsToCheck.add(tweet.id);
      roomIds.add(
        stringToUuid2(tweet.conversationId + "-" + this.runtime.agentId)
      );
    }
    const existingMemories = await this.runtime.messageManager.getMemoriesByRoomIds({
      roomIds: Array.from(roomIds)
    });
    const existingMemoryIds = new Set(
      existingMemories.map((memory) => memory.id)
    );
    const tweetsToSave = allTweets.filter(
      (tweet) => !existingMemoryIds.has(
        stringToUuid2(tweet.id + "-" + this.runtime.agentId)
      )
    );
    elizaLogger2.debug({
      processingTweets: tweetsToSave.map((tweet) => tweet.id).join(",")
    });
    await this.runtime.ensureUserExists(
      this.runtime.agentId,
      this.profile.username,
      this.runtime.character.name,
      "twitter"
    );
    for (const tweet of tweetsToSave) {
      elizaLogger2.log("Saving Tweet", tweet.id);
      const roomId = stringToUuid2(
        tweet.conversationId + "-" + this.runtime.agentId
      );
      const userId = tweet.userId === this.profile.id ? this.runtime.agentId : stringToUuid2(tweet.userId);
      if (tweet.userId === this.profile.id) {
        await this.runtime.ensureConnection(
          this.runtime.agentId,
          roomId,
          this.profile.username,
          this.profile.name,
          "twitter"
        );
      } else {
        await this.runtime.ensureConnection(
          userId,
          roomId,
          tweet.username,
          tweet.name,
          "twitter"
        );
      }
      const content = {
        text: tweet.text,
        url: tweet.permanentUrl,
        source: "twitter",
        inReplyTo: tweet.inReplyToStatusId ? stringToUuid2(tweet.inReplyToStatusId) : void 0
      };
      await this.runtime.messageManager.createMemory({
        id: stringToUuid2(tweet.id + "-" + this.runtime.agentId),
        userId,
        content,
        agentId: this.runtime.agentId,
        roomId,
        embedding: getEmbeddingZeroVector2(),
        createdAt: tweet.timestamp * 1e3
      });
      await this.cacheTweet(tweet);
    }
    await this.cacheTimeline(timeline);
    await this.cacheMentions(mentionsAndInteractions.tweets);
  }
  async setCookiesFromArray(cookiesArray) {
    const cookieStrings = cookiesArray.map(
      (cookie) => `${cookie.key}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}; ${cookie.secure ? "Secure" : ""}; ${cookie.httpOnly ? "HttpOnly" : ""}; SameSite=${cookie.sameSite || "Lax"}`
    );
    await this.twitterClient.setCookies(cookieStrings);
  }
  async saveRequestMessage(message, state) {
    if (message.content.text) {
      const recentMessage = await this.runtime.messageManager.getMemories(
        {
          roomId: message.roomId,
          count: 1,
          unique: false
        }
      );
      if (recentMessage.length > 0 && recentMessage[0].content === message.content) {
        elizaLogger2.debug("Message already saved", recentMessage[0].id);
      } else {
        await this.runtime.messageManager.createMemory({
          ...message,
          embedding: getEmbeddingZeroVector2()
        });
      }
      await this.runtime.evaluate(message, {
        ...state,
        twitterClient: this.twitterClient
      });
    }
  }
  async loadLatestCheckedTweetId() {
    const latestCheckedTweetId = await this.runtime.cacheManager.get(
      `twitter/${this.profile.username}/latest_checked_tweet_id`
    );
    if (latestCheckedTweetId) {
      this.lastCheckedTweetId = BigInt(latestCheckedTweetId);
    }
  }
  async cacheLatestCheckedTweetId() {
    if (this.lastCheckedTweetId) {
      await this.runtime.cacheManager.set(
        `twitter/${this.profile.username}/latest_checked_tweet_id`,
        this.lastCheckedTweetId.toString()
      );
    }
  }
  async getCachedTimeline() {
    return await this.runtime.cacheManager.get(
      `twitter/${this.profile.username}/timeline`
    );
  }
  async cacheTimeline(timeline) {
    await this.runtime.cacheManager.set(
      `twitter/${this.profile.username}/timeline`,
      timeline,
      { expires: Date.now() + 10 * 1e3 }
    );
  }
  async cacheMentions(mentions) {
    await this.runtime.cacheManager.set(
      `twitter/${this.profile.username}/mentions`,
      mentions,
      { expires: Date.now() + 10 * 1e3 }
    );
  }
  async getCachedCookies(username) {
    return await this.runtime.cacheManager.get(
      `twitter/${username}/cookies`
    );
  }
  async cacheCookies(username, cookies) {
    await this.runtime.cacheManager.set(
      `twitter/${username}/cookies`,
      cookies
    );
  }
  async getAuthenticatedUserData() {
    try {
      const user = await this.requestQueue.add(async () => {
        return await this.twitterClient.v2.me({
          "user.fields": "description"
        });
      });
      elizaLogger2.debug("Authenticated User's data:", user);
      return user.data;
    } catch (error) {
      elizaLogger2.error("Error fetching authenticated user info:", error);
      throw error;
    }
  }
  async fetchProfile() {
    elizaLogger2.info("Fetching profile of authenticated user.");
    const userData = await this.getAuthenticatedUserData();
    return {
      id: userData.id,
      username: userData.username,
      name: userData.name,
      bio: userData.description,
      nicknames: []
    };
  }
};

// src/environment.ts
import {
  parseBooleanFromText,
  ActionTimelineType as ActionTimelineType2
} from "@elizaos/core";
import { z, ZodError } from "zod";
var DEFAULT_MAX_TWEET_LENGTH = 280;
var twitterUsernameSchema = z.string().min(1, "An X/Twitter Username must be at least 1 character long").max(15, "An X/Twitter Username cannot exceed 15 characters").refine((username) => {
  if (username === "*") return true;
  return /^[A-Za-z0-9_]+$/.test(username);
}, "An X Username can only contain letters, numbers, and underscores");
var twitterEnvSchema = z.object({
  TWITTER_DRY_RUN: z.boolean(),
  TWITTER_APP_KEY: z.string().min(1, "X/Twitter App Key is required"),
  TWITTER_APP_SECRET: z.string().min(1, "X/Twitter App Secret is required"),
  TWITTER_ACCESS_TOKEN: z.string().min(1, "X/Twitter Access Token is required"),
  TWITTER_ACCESS_SECRET: z.string().min(1, "X/Twitter Access Secret is required"),
  MAX_TWEET_LENGTH: z.number().int().default(DEFAULT_MAX_TWEET_LENGTH),
  TWITTER_SEARCH_ENABLE: z.boolean().default(false),
  TWITTER_RETRY_LIMIT: z.number().int(),
  TWITTER_POLL_INTERVAL: z.number().int(),
  TWITTER_TARGET_USERS: z.array(twitterUsernameSchema).default([]),
  ENABLE_TWITTER_POST_GENERATION: z.boolean().default(true),
  POST_INTERVAL_MIN: z.number().int(),
  POST_INTERVAL_MAX: z.number().int(),
  ENABLE_ACTION_PROCESSING: z.boolean().default(false),
  ACTION_INTERVAL: z.number().int(),
  POST_IMMEDIATELY: z.boolean().default(false),
  TWITTER_SPACES_ENABLE: z.boolean().default(false),
  MAX_ACTIONS_PROCESSING: z.number().int(),
  ACTION_TIMELINE_TYPE: z.nativeEnum(ActionTimelineType2).default(ActionTimelineType2.ForYou)
});
function parseTargetUsers(targetUsersStr) {
  if (!(targetUsersStr == null ? void 0 : targetUsersStr.trim())) {
    return [];
  }
  return targetUsersStr.split(",").map((user) => user.trim()).filter(Boolean);
}
function safeParseInt(value, defaultValue) {
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : Math.max(1, parsed);
}
async function validateTwitterConfig(runtime) {
  try {
    const twitterConfig = {
      TWITTER_DRY_RUN: parseBooleanFromText(
        runtime.getSetting("TWITTER_DRY_RUN") || process.env.TWITTER_DRY_RUN
      ) ?? false,
      // parseBooleanFromText return null if "", map "" to false
      TWITTER_APP_KEY: runtime.getSetting("TWITTER_APP_KEY") || process.env.TWITTER_APP_KEY,
      TWITTER_APP_SECRET: runtime.getSetting("TWITTER_APP_SECRET") || process.env.TWITTER_APP_SECRET,
      TWITTER_ACCESS_TOKEN: runtime.getSetting("TWITTER_ACCESS_TOKEN") || process.env.TWITTER_ACCESS_TOKEN,
      TWITTER_ACCESS_SECRET: runtime.getSetting("TWITTER_ACCESS_SECRET") || process.env.TWITTER_ACCESS_SECRET,
      // number as string?
      MAX_TWEET_LENGTH: safeParseInt(
        runtime.getSetting("MAX_TWEET_LENGTH") || process.env.MAX_TWEET_LENGTH,
        DEFAULT_MAX_TWEET_LENGTH
      ),
      TWITTER_SEARCH_ENABLE: parseBooleanFromText(
        runtime.getSetting("TWITTER_SEARCH_ENABLE") || process.env.TWITTER_SEARCH_ENABLE
      ) ?? false,
      // string passthru
      TWITTER_2FA_SECRET: runtime.getSetting("TWITTER_2FA_SECRET") || process.env.TWITTER_2FA_SECRET || "",
      // int
      TWITTER_RETRY_LIMIT: safeParseInt(
        runtime.getSetting("TWITTER_RETRY_LIMIT") || process.env.TWITTER_RETRY_LIMIT,
        5
      ),
      // int in seconds
      TWITTER_POLL_INTERVAL: safeParseInt(
        runtime.getSetting("TWITTER_POLL_INTERVAL") || process.env.TWITTER_POLL_INTERVAL,
        120
        // 2m
      ),
      // comma separated string
      TWITTER_TARGET_USERS: parseTargetUsers(
        runtime.getSetting("TWITTER_TARGET_USERS") || process.env.TWITTER_TARGET_USERS
      ),
      // bool
      ENABLE_TWITTER_POST_GENERATION: parseBooleanFromText(
        runtime.getSetting("ENABLE_TWITTER_POST_GENERATION") || process.env.ENABLE_TWITTER_POST_GENERATION
      ) ?? true,
      // int in minutes
      POST_INTERVAL_MIN: safeParseInt(
        runtime.getSetting("POST_INTERVAL_MIN") || process.env.POST_INTERVAL_MIN,
        90
        // 1.5 hours
      ),
      // int in minutes
      POST_INTERVAL_MAX: safeParseInt(
        runtime.getSetting("POST_INTERVAL_MAX") || process.env.POST_INTERVAL_MAX,
        180
        // 3 hours
      ),
      // bool
      ENABLE_ACTION_PROCESSING: parseBooleanFromText(
        runtime.getSetting("ENABLE_ACTION_PROCESSING") || process.env.ENABLE_ACTION_PROCESSING
      ) ?? false,
      // init in minutes (min 1m)
      ACTION_INTERVAL: safeParseInt(
        runtime.getSetting("ACTION_INTERVAL") || process.env.ACTION_INTERVAL,
        5
        // 5 minutes
      ),
      // bool
      POST_IMMEDIATELY: parseBooleanFromText(
        runtime.getSetting("POST_IMMEDIATELY") || process.env.POST_IMMEDIATELY
      ) ?? false,
      TWITTER_SPACES_ENABLE: parseBooleanFromText(
        runtime.getSetting("TWITTER_SPACES_ENABLE") || process.env.TWITTER_SPACES_ENABLE
      ) ?? false,
      MAX_ACTIONS_PROCESSING: safeParseInt(
        runtime.getSetting("MAX_ACTIONS_PROCESSING") || process.env.MAX_ACTIONS_PROCESSING,
        1
      ),
      ACTION_TIMELINE_TYPE: runtime.getSetting("ACTION_TIMELINE_TYPE") || process.env.ACTION_TIMELINE_TYPE
    };
    return twitterEnvSchema.parse(twitterConfig);
  } catch (error) {
    if (error instanceof ZodError) {
      const errorMessages = error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n");
      throw new Error(
        `X/Twitter configuration validation failed:
${errorMessages}`
      );
    }
    throw error;
  }
}

// src/interactions.ts
import {
  composeContext,
  generateMessageResponse,
  generateShouldRespond,
  messageCompletionFooter,
  shouldRespondFooter,
  ModelClass,
  stringToUuid as stringToUuid3,
  elizaLogger as elizaLogger3,
  getEmbeddingZeroVector as getEmbeddingZeroVector3,
  ServiceType
} from "@elizaos/core";
var twitterMessageHandlerTemplate = `
# Areas of Expertise
{{knowledge}}

# About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{providers}}

{{characterPostExamples}}

{{postDirections}}

Recent interactions between {{agentName}} and other users:
{{recentPostInteractions}}

{{recentPosts}}

# TASK: Generate a post/reply in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}) while using the thread of tweets as additional context:

Current Post:
{{currentPost}}
Here is the descriptions of images in the Current post.
{{imageDescriptions}}

Thread of Tweets You Are Replying To:
{{formattedConversation}}

# INSTRUCTIONS: Generate a post in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}). You MUST include an action if the current post text includes a prompt that is similar to one of the available actions mentioned here:
{{actionNames}}
{{actions}}

Here is the current post text again. Remember to include an action if the current post text includes a prompt that asks for one of the available actions mentioned above (does not need to be exact)
{{currentPost}}
Here is the descriptions of images in the Current post.
{{imageDescriptions}}
` + messageCompletionFooter;
var twitterShouldRespondTemplate = (targetUsersStr) => `# INSTRUCTIONS: Determine if {{agentName}} (@{{twitterUserName}}) should respond to the message and participate in the conversation. Do not comment. Just respond with "true" or "false".

Response options are RESPOND, IGNORE and STOP.

PRIORITY RULE: ALWAYS RESPOND to these users regardless of topic or message content: ${targetUsersStr}. Topic relevance should be ignored for these users.

For other users:
- {{agentName}} should RESPOND to messages directed at them
- {{agentName}} should RESPOND to conversations relevant to their background
- {{agentName}} should IGNORE irrelevant messages
- {{agentName}} should IGNORE very short messages unless directly addressed
- {{agentName}} should STOP if asked to stop
- {{agentName}} should STOP if conversation is concluded
- {{agentName}} is in a room with other users and wants to be conversational, but not annoying.

IMPORTANT:
- {{agentName}} (aka @{{twitterUserName}}) is particularly sensitive about being annoying, so if there is any doubt, it is better to IGNORE than to RESPOND.
- For users not in the priority list, {{agentName}} (@{{twitterUserName}}) should err on the side of IGNORE rather than RESPOND if in doubt.

Recent Posts:
{{recentPosts}}

Current Post:
{{currentPost}}

Thread of Tweets You Are Replying To:
{{formattedConversation}}

# INSTRUCTIONS: Respond with [RESPOND] if {{agentName}} should respond, or [IGNORE] if {{agentName}} should not respond to the last message and [STOP] if {{agentName}} should stop participating in the conversation.
` + shouldRespondFooter;
var TwitterInteractionClient = class {
  client;
  runtime;
  isDryRun;
  constructor(client, runtime) {
    this.client = client;
    this.runtime = runtime;
    this.isDryRun = this.client.twitterConfig.TWITTER_DRY_RUN;
  }
  async start() {
    const handleTwitterInteractionsLoop = () => {
      this.handleTwitterInteractions();
      setTimeout(
        handleTwitterInteractionsLoop,
        // Defaults to 2 minutes
        this.client.twitterConfig.TWITTER_POLL_INTERVAL * 1e3
      );
    };
    handleTwitterInteractionsLoop();
  }
  async handleTwitterInteractions() {
    var _a;
    elizaLogger3.log("Checking Twitter interactions");
    try {
      const mentionCandidates = await this.client.getMentions(this.client.profile.id, 10);
      elizaLogger3.debug(`Fetched ${mentionCandidates.length} mentions`);
      let uniqueTweetCandidates = [...mentionCandidates];
      uniqueTweetCandidates.sort((a, b) => a.id.localeCompare(b.id)).filter((tweet) => tweet.authorId !== this.client.profile.id);
      for (const tweet of uniqueTweetCandidates) {
        if (!this.client.lastCheckedTweetId || BigInt(tweet.id) > this.client.lastCheckedTweetId) {
          elizaLogger3.log("processing tweet: ", tweet);
          const tweetId = stringToUuid3(`${tweet.id}-${this.runtime.agentId}`);
          const existingResponse = await this.runtime.messageManager.getMemoryById(
            tweetId
          );
          if (existingResponse) {
            elizaLogger3.log(
              `Already responded to tweet ${tweet.id}, skipping`
            );
            continue;
          }
          const roomId = stringToUuid3(`${tweet.conversationId}-${this.runtime.agentId}`);
          const userIdUUID = tweet.authorId === this.client.profile.id ? this.runtime.agentId : stringToUuid3(tweet.authorId);
          await this.runtime.ensureConnection(
            userIdUUID,
            roomId,
            tweet.authorUsername,
            tweet.authorName,
            "twitter"
          );
          const thread = await buildConversationThread(
            tweet,
            this.client
          );
          const message = {
            content: {
              text: tweet.text,
              imageUrls: ((_a = tweet.photos) == null ? void 0 : _a.map((photo) => photo.url)) || [],
              source: "twitter"
            },
            agentId: this.runtime.agentId,
            userId: userIdUUID,
            roomId
          };
          await this.handleTweet({
            tweet,
            message,
            thread
          });
          this.client.lastCheckedTweetId = BigInt(tweet.id);
        }
      }
      await this.client.cacheLatestCheckedTweetId();
      elizaLogger3.log("Finished checking Twitter interactions");
    } catch (error) {
      console.error(error);
      elizaLogger3.error("Error handling Twitter interactions:", error);
    }
  }
  async handleTweet({
    tweet,
    message,
    thread
  }) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    if (tweet.authorId === this.client.profile.id && !this.client.twitterConfig.TWITTER_TARGET_USERS.includes(tweet.authorUsername)) {
      return;
    }
    if (!message.content.text) {
      elizaLogger3.log("Skipping Tweet with no text", tweet.id);
      return { text: "", action: "IGNORE" };
    }
    elizaLogger3.log("Processing Tweet: ", tweet.id);
    const formatTweet = (tweet2) => {
      return `ID: ${tweet2.id}
From: ${tweet2.authorName} (@${tweet2.authorUsername})
Text: ${tweet2.text}`;
    };
    const currentPost = formatTweet(tweet);
    const formattedConversation = thread.map(
      (tweet2) => `@${tweet2.authorUsername} (${new Date(
        tweet2.timestamp * 1e3
      ).toLocaleString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        day: "numeric"
      })}):
                ${tweet2.text}`
    ).join("\n\n");
    const imageDescriptionsArray = [];
    try {
      for (const photo of tweet.photos) {
        const description = await this.runtime.getService(
          ServiceType.IMAGE_DESCRIPTION
        ).describeImage(photo.url);
        imageDescriptionsArray.push(description);
      }
    } catch (error) {
      elizaLogger3.error("Error Occured during describing image: ", error);
    }
    let state = await this.runtime.composeState(message, {
      twitterClient: this.client.twitterClient,
      twitterUserName: this.client.profile.username,
      currentPost,
      formattedConversation,
      imageDescriptions: imageDescriptionsArray.length > 0 ? `
Images in Tweet:
${imageDescriptionsArray.map((desc, i) => `Image ${i + 1}: Title: ${desc.title}
Description: ${desc.description}`).join("\n\n")}` : ""
    });
    const tweetId = stringToUuid3(tweet.id + "-" + this.runtime.agentId);
    const tweetExists = await this.runtime.messageManager.getMemoryById(tweetId);
    if (!tweetExists) {
      elizaLogger3.log("tweet does not exist, saving");
      const userIdUUID = stringToUuid3(tweet.authorId);
      const roomId = stringToUuid3(tweet.conversationId);
      const message2 = {
        id: tweetId,
        agentId: this.runtime.agentId,
        content: {
          text: tweet.text,
          url: tweet.permanentUrl,
          imageUrls: ((_a = tweet.photos) == null ? void 0 : _a.map((photo) => photo.url)) || [],
          inReplyTo: tweet.inReplyToStatusId ? stringToUuid3(
            tweet.inReplyToStatusId + "-" + this.runtime.agentId
          ) : void 0
        },
        userId: userIdUUID,
        roomId,
        createdAt: tweet.timestamp * 1e3
      };
      this.client.saveRequestMessage(message2, state);
    }
    const validTargetUsersStr = this.client.twitterConfig.TWITTER_TARGET_USERS.join(",");
    const shouldRespondContext = composeContext({
      state,
      template: ((_b = this.runtime.character.templates) == null ? void 0 : _b.twitterShouldRespondTemplate) || ((_d = (_c = this.runtime.character) == null ? void 0 : _c.templates) == null ? void 0 : _d.shouldRespondTemplate) || twitterShouldRespondTemplate(validTargetUsersStr)
    });
    const shouldRespond = await generateShouldRespond({
      runtime: this.runtime,
      context: shouldRespondContext,
      modelClass: ModelClass.MEDIUM
    });
    if (shouldRespond !== "RESPOND") {
      elizaLogger3.log("Not responding to message");
      return { text: "Response Decision:", action: shouldRespond };
    }
    const context = composeContext({
      state: {
        ...state,
        // Convert actionNames array to string
        actionNames: Array.isArray(state.actionNames) ? state.actionNames.join(", ") : state.actionNames || "",
        actions: Array.isArray(state.actions) ? state.actions.join("\n") : state.actions || "",
        // Ensure character examples are included
        characterPostExamples: this.runtime.character.messageExamples ? this.runtime.character.messageExamples.map(
          (example) => example.map(
            (msg) => `${msg.user}: ${msg.content.text}${msg.content.action ? ` [Action: ${msg.content.action}]` : ""}`
          ).join("\n")
        ).join("\n\n") : ""
      },
      template: ((_e = this.runtime.character.templates) == null ? void 0 : _e.twitterMessageHandlerTemplate) || ((_g = (_f = this.runtime.character) == null ? void 0 : _f.templates) == null ? void 0 : _g.messageHandlerTemplate) || twitterMessageHandlerTemplate
    });
    const response = await generateMessageResponse({
      runtime: this.runtime,
      context,
      modelClass: ModelClass.LARGE
    });
    const removeQuotes = (str) => str.replace(/^['"](.*)['"]$/, "$1");
    const stringId = stringToUuid3(tweet.id + "-" + this.runtime.agentId);
    response.inReplyTo = stringId;
    response.text = removeQuotes(response.text);
    if (response.text) {
      if (this.isDryRun) {
        elizaLogger3.info(
          `Dry run: Selected Post: ${tweet.id} - ${tweet.authorUsername}: ${tweet.text}
Agent's Output:
${response.text}`
        );
      } else {
        try {
          const callback = async (response2, tweetId2) => {
            const memories = await sendTweet(
              this.client,
              response2,
              message.roomId,
              tweetId2 || tweet.id
            );
            return memories;
          };
          const action = this.runtime.actions.find((a) => a.name === response.action);
          const shouldSuppressInitialMessage = action == null ? void 0 : action.suppressInitialMessage;
          let responseMessages = [];
          if (!shouldSuppressInitialMessage) {
            responseMessages = await callback(response);
          } else {
            responseMessages = [{
              id: stringToUuid3(tweet.id + "-" + this.runtime.agentId),
              userId: this.runtime.agentId,
              agentId: this.runtime.agentId,
              content: response,
              roomId: message.roomId,
              embedding: getEmbeddingZeroVector3(),
              createdAt: Date.now()
            }];
          }
          state = await this.runtime.updateRecentMessageState(
            state
          );
          for (const responseMessage of responseMessages) {
            if (responseMessage === responseMessages[responseMessages.length - 1]) {
              responseMessage.content.action = response.action;
            } else {
              responseMessage.content.action = "CONTINUE";
            }
            await this.runtime.messageManager.createMemory(
              responseMessage
            );
          }
          const responseTweetId = (_i = (_h = responseMessages[responseMessages.length - 1]) == null ? void 0 : _h.content) == null ? void 0 : _i.tweetId;
          await this.runtime.processActions(
            message,
            responseMessages,
            state,
            (response2) => {
              return callback(response2, responseTweetId);
            }
          );
          const responseInfo = `Context:

${context}

Selected Post: ${tweet.id} - @${tweet.authorUsername}: ${tweet.text}
Agent's Output:
${response.text}`;
          await this.runtime.cacheManager.set(
            `twitter/tweet_generation_${tweet.id}.txt`,
            responseInfo
          );
          await wait();
        } catch (error) {
          elizaLogger3.error(`Error sending response tweet: ${error}`);
        }
      }
    }
  }
};

// src/post.ts
import {
  TwitterV2IncludesHelper as TwitterV2IncludesHelper3
} from "twitter-api-v2";
import {
  composeContext as composeContext2,
  generateText,
  getEmbeddingZeroVector as getEmbeddingZeroVector4,
  ModelClass as ModelClass2,
  stringToUuid as stringToUuid4,
  truncateToCompleteSentence,
  parseJSONObjectFromText,
  extractAttributes,
  cleanJsonResponse,
  elizaLogger as elizaLogger4
} from "@elizaos/core";
import { postActionResponseFooter } from "@elizaos/core";
import {
  Client,
  Events,
  GatewayIntentBits,
  TextChannel,
  Partials
} from "discord.js";
var twitterPostTemplate = `
# Areas of Expertise
{{knowledge}}

# About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{providers}}

{{characterPostExamples}}

{{postDirections}}

# Task: Generate a post in the voice and style and perspective of {{agentName}} @{{twitterUserName}}.
Write a post that is {{adjective}} about {{topic}} (without mentioning {{topic}} directly), from the perspective of {{agentName}}. Do not add commentary or acknowledge this request, just write the post.
Your response should be 1, 2, or 3 sentences (choose the length at random).
Your response should not contain any questions. Brief, concise statements only. The total character count MUST be less than {{maxTweetLength}}. No emojis. Use \\n\\n (double spaces) between statements if there are multiple statements in your response.`;
var twitterActionTemplate = `
# INSTRUCTIONS: Determine actions for {{agentName}} (@{{twitterUserName}}) based on:
{{bio}}
{{postDirections}}

Guidelines:
- ONLY engage with content that DIRECTLY relates to character's core interests
- Direct mentions are priority IF they are on-topic
- Skip ALL content that is:
  - Off-topic or tangentially related
  - From high-profile accounts unless explicitly relevant
  - Generic/viral content without specific relevance
  - Political/controversial unless central to character
  - Promotional/marketing unless directly relevant

Actions (respond only with tags):
[LIKE] - Perfect topic match AND aligns with character (9.8/10)
[RETWEET] - Exceptional content that embodies character's expertise (9.5/10)
[QUOTE] - Can add substantial domain expertise (9.5/10)
[REPLY] - Can contribute meaningful, expert-level insight (9.5/10)

Tweet:
{{currentTweet}}

# Respond with qualifying action tags only. Default to NO action unless extremely confident of relevance.` + postActionResponseFooter;
var TwitterPostClient = class {
  client;
  runtime;
  twitterUsername;
  isProcessing = false;
  lastProcessTime = 0;
  stopProcessingActions = false;
  isDryRun;
  discordClientForApproval;
  approvalRequired = false;
  discordApprovalChannelId;
  approvalCheckInterval;
  constructor(client, runtime) {
    var _a, _b;
    this.client = client;
    this.runtime = runtime;
    this.isDryRun = this.client.twitterConfig.TWITTER_DRY_RUN;
    elizaLogger4.log("Twitter Client Configuration:");
    elizaLogger4.log(`- Username: ${(_a = this.client.profile) == null ? void 0 : _a.username}`);
    elizaLogger4.log(
      `- Dry Run Mode: ${this.isDryRun ? "enabled" : "disabled"}`
    );
    elizaLogger4.log(
      `- Enable Post: ${this.client.twitterConfig.ENABLE_TWITTER_POST_GENERATION ? "enabled" : "disabled"}`
    );
    elizaLogger4.log(
      `- Post Interval: ${this.client.twitterConfig.POST_INTERVAL_MIN}-${this.client.twitterConfig.POST_INTERVAL_MAX} minutes`
    );
    elizaLogger4.log(
      `- Action Processing: ${this.client.twitterConfig.ENABLE_ACTION_PROCESSING ? "enabled" : "disabled"}`
    );
    elizaLogger4.log(
      `- Action Interval: ${this.client.twitterConfig.ACTION_INTERVAL} minutes`
    );
    elizaLogger4.log(
      `- Post Immediately: ${this.client.twitterConfig.POST_IMMEDIATELY ? "enabled" : "disabled"}`
    );
    elizaLogger4.log(
      `- Search Enabled: ${this.client.twitterConfig.TWITTER_SEARCH_ENABLE ? "enabled" : "disabled"}`
    );
    const targetUsers = this.client.twitterConfig.TWITTER_TARGET_USERS;
    if (targetUsers) {
      elizaLogger4.log(`- Target Users: ${targetUsers}`);
    }
    if (this.isDryRun) {
      elizaLogger4.log(
        "Twitter client initialized in dry run mode - no actual tweets should be posted"
      );
    }
    const approvalRequired = ((_b = this.runtime.getSetting("TWITTER_APPROVAL_ENABLED")) == null ? void 0 : _b.toLocaleLowerCase()) === "true";
    if (approvalRequired) {
      const discordToken = this.runtime.getSetting(
        "TWITTER_APPROVAL_DISCORD_BOT_TOKEN"
      );
      const approvalChannelId = this.runtime.getSetting(
        "TWITTER_APPROVAL_DISCORD_CHANNEL_ID"
      );
      const APPROVAL_CHECK_INTERVAL = Number.parseInt(
        this.runtime.getSetting("TWITTER_APPROVAL_CHECK_INTERVAL")
      ) || 5 * 60 * 1e3;
      this.approvalCheckInterval = APPROVAL_CHECK_INTERVAL;
      if (!discordToken || !approvalChannelId) {
        throw new Error(
          "TWITTER_APPROVAL_DISCORD_BOT_TOKEN and TWITTER_APPROVAL_DISCORD_CHANNEL_ID are required for approval workflow"
        );
      }
      this.approvalRequired = true;
      this.discordApprovalChannelId = approvalChannelId;
      this.setupDiscordClient();
    }
  }
  setupDiscordClient() {
    this.discordClientForApproval = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
      ],
      partials: [Partials.Channel, Partials.Message, Partials.Reaction]
    });
    this.discordClientForApproval.once(
      Events.ClientReady,
      (readyClient) => {
        elizaLogger4.log(
          `Discord bot is ready as ${readyClient.user.tag}!`
        );
        const invite = `https://discord.com/api/oauth2/authorize?client_id=${readyClient.user.id}&permissions=274877991936&scope=bot`;
        elizaLogger4.log(
          `Use this link to properly invite the Twitter Post Approval Discord bot: ${invite}`
        );
      }
    );
    this.discordClientForApproval.login(
      this.runtime.getSetting("TWITTER_APPROVAL_DISCORD_BOT_TOKEN")
    );
  }
  async start() {
    if (!this.client.profile.username) {
      await this.client.init();
    }
    const generateNewTweetLoop = async () => {
      const lastPost = await this.runtime.cacheManager.get("twitter/" + this.client.profile.username + "/lastPost");
      const lastPostTimestamp = (lastPost == null ? void 0 : lastPost.timestamp) ?? 0;
      elizaLogger4.debug(`Last post timestamp: ${lastPostTimestamp}`);
      const minMinutes = this.client.twitterConfig.POST_INTERVAL_MIN;
      const maxMinutes = this.client.twitterConfig.POST_INTERVAL_MAX;
      const randomMinutes = Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
      const delay = randomMinutes * 60 * 1e3;
      const timeSinceLastPost = Date.now() - new Date(lastPostTimestamp).getTime();
      if (timeSinceLastPost >= delay) {
        elizaLogger4.debug(`Time since last post: ${timeSinceLastPost}ms, generating new tweet`);
        await this.generateNewTweet();
        setTimeout(() => {
          generateNewTweetLoop();
        }, randomMinutes * 60 * 1e3);
      } else {
        const remainingDelay = delay - timeSinceLastPost;
        elizaLogger4.debug(`Time since last post: ${timeSinceLastPost}ms, next check in ${remainingDelay}ms`);
        setTimeout(() => {
          generateNewTweetLoop();
        }, remainingDelay);
      }
      elizaLogger4.log(`Next tweet scheduled in ${randomMinutes} minutes`);
    };
    if (this.client.twitterConfig.POST_IMMEDIATELY) {
      await this.generateNewTweet();
    }
    if (this.client.twitterConfig.ENABLE_TWITTER_POST_GENERATION) {
      generateNewTweetLoop();
      elizaLogger4.log("Tweet generation loop started");
    }
    if (this.approvalRequired) this.runPendingTweetCheckLoop();
  }
  runPendingTweetCheckLoop() {
    setInterval(async () => {
      await this.handlePendingTweet();
    }, this.approvalCheckInterval);
  }
  async processAndCacheTweet(runtime, client, tweet, roomId, rawTweetContent) {
    await runtime.cacheManager.set(
      `twitter/${client.profile.username}/lastPost`,
      {
        id: tweet.id,
        timestamp: tweet.timestamp
      }
    );
    await client.cacheTweet(tweet);
    elizaLogger4.log(`Tweet posted:
 ${tweet.permanentUrl}`);
    await runtime.ensureRoomExists(roomId);
    await runtime.ensureParticipantInRoom(runtime.agentId, roomId);
    await runtime.messageManager.createMemory({
      id: stringToUuid4(tweet.id + "-" + runtime.agentId),
      userId: runtime.agentId,
      agentId: runtime.agentId,
      content: {
        text: rawTweetContent.trim(),
        url: tweet.permanentUrl,
        source: "twitter"
      },
      roomId,
      embedding: getEmbeddingZeroVector4(),
      createdAt: tweet.timestamp
    });
  }
  // TODO: #TWITTER-V2-006 - Reimplement note tweet handling using Twitter API v2
  // async handleNoteTweet(
  //     client: ClientBase,
  //     content: string,
  //     tweetId?: string,
  //     mediaData?: MediaData[]
  // ) {
  //     try {
  //         const noteTweetResult = await client.requestQueue.add(
  //             async () =>
  //                 await client.twitterClient.sendNoteTweet(
  //                     content,
  //                     tweetId,
  //                     mediaData
  //                 )
  //         );
  //         if (noteTweetResult.errors && noteTweetResult.errors.length > 0) {
  //             // Note Tweet failed due to authorization. Falling back to standard Tweet.
  //             const truncateContent = truncateToCompleteSentence(
  //                 content,
  //                 this.client.twitterConfig.MAX_TWEET_LENGTH
  //             );
  //             return await this.sendStandardTweet(
  //                 client,
  //                 truncateContent,
  //                 tweetId
  //             );
  //         } else {
  //             return noteTweetResult.data.notetweet_create.tweet_results
  //                 .result;
  //         }
  //     } catch (error) {
  //         throw new Error(`Note Tweet failed: ${error}`);
  //     }
  // }
  async sendStandardTweet(client, content, inReplyToTweetId, mediaData) {
    try {
      const standardTweetResult = await client.requestQueue.add(
        async () => {
          const payload = {
            text: content
          };
          if (inReplyToTweetId) {
            payload.reply = {
              in_reply_to_tweet_id: inReplyToTweetId
            };
          }
          const result = await client.twitterClient.v2.tweet(payload);
          return result;
        }
      );
      if (!standardTweetResult.data) {
        elizaLogger4.error("Error sending tweet; Bad response:", standardTweetResult);
        return;
      }
      return standardTweetResult.data;
    } catch (error) {
      elizaLogger4.error("Error sending standard Tweet:", error);
      console.error(error);
      throw error;
    }
  }
  async postTweet(runtime, client, tweetTextForPosting, roomId, rawTweetContent, inReplyToTweetId, mediaData) {
    try {
      elizaLogger4.log(`Posting new tweet:
`);
      let result;
      if (tweetTextForPosting.length > DEFAULT_MAX_TWEET_LENGTH) {
        elizaLogger4.error("must reimplement note tweets using twitter v2 api");
      } else {
        result = await this.sendStandardTweet(
          client,
          tweetTextForPosting,
          inReplyToTweetId,
          mediaData
        );
      }
      const fetchedTweet = await this.client.requestQueue.add(
        async () => await client.twitterClient.v2.singleTweet(result.id, {
          "tweet.fields": "created_at,author_id,conversation_id,entities,referenced_tweets,text",
          "expansions": "author_id,referenced_tweets.id"
        })
      );
      const tweet = createElizaTweet(
        fetchedTweet.data,
        new TwitterV2IncludesHelper3(fetchedTweet)
      );
      await this.processAndCacheTweet(
        runtime,
        client,
        tweet,
        roomId,
        rawTweetContent
      );
    } catch (error) {
      console.error(error);
      elizaLogger4.error("Error sending tweet:", error);
    }
  }
  /**
   * Posts a thread of tweets.
   * @param tweets - An array of SendTweetV2Params or strings.
   * @param client - The client to use to post the tweets.
   * @returns An array of TweetV2PostTweetResult objects.
   */
  async postTweetThread(tweets) {
    const sentTweets = await this.client.twitterClient.v2.tweetThread(tweets);
    return sentTweets;
  }
  /**
   * Generates and posts a new tweet. If isDryRun is true, only logs what would have been posted.
   */
  async generateNewTweet() {
    var _a;
    elizaLogger4.log("Generating new tweet");
    try {
      const roomId = stringToUuid4(
        "twitter_generate_room-" + this.client.profile.username
      );
      await this.runtime.ensureUserExists(
        this.runtime.agentId,
        this.client.profile.username,
        this.runtime.character.name,
        "twitter"
      );
      const topics = this.runtime.character.topics.join(", ");
      const maxTweetLength = this.client.twitterConfig.MAX_TWEET_LENGTH;
      const state = await this.runtime.composeState(
        {
          userId: this.runtime.agentId,
          roomId,
          agentId: this.runtime.agentId,
          content: {
            text: topics || "",
            action: "TWEET"
          }
        },
        {
          twitterUserName: this.client.profile.username,
          maxTweetLength
        }
      );
      const context = composeContext2({
        state,
        template: ((_a = this.runtime.character.templates) == null ? void 0 : _a.twitterPostTemplate) || twitterPostTemplate
      });
      elizaLogger4.debug("generate post prompt:\n" + context);
      const response = await generateText({
        runtime: this.runtime,
        context,
        modelClass: ModelClass2.SMALL
      });
      const rawTweetContent = cleanJsonResponse(response);
      let tweetTextForPosting = null;
      let mediaData = null;
      const parsedResponse = parseJSONObjectFromText(rawTweetContent);
      if (parsedResponse == null ? void 0 : parsedResponse.text) {
        tweetTextForPosting = parsedResponse.text;
      } else {
        tweetTextForPosting = rawTweetContent.trim();
      }
      if ((parsedResponse == null ? void 0 : parsedResponse.attachments) && (parsedResponse == null ? void 0 : parsedResponse.attachments.length) > 0) {
        mediaData = await fetchMediaData(parsedResponse.attachments);
      }
      if (!tweetTextForPosting) {
        const parsingText = extractAttributes(rawTweetContent, [
          "text"
        ]).text;
        if (parsingText) {
          tweetTextForPosting = truncateToCompleteSentence(
            extractAttributes(rawTweetContent, ["text"]).text,
            this.client.twitterConfig.MAX_TWEET_LENGTH
          );
        }
      }
      if (!tweetTextForPosting) {
        tweetTextForPosting = rawTweetContent;
      }
      if (maxTweetLength) {
        tweetTextForPosting = truncateToCompleteSentence(
          tweetTextForPosting,
          maxTweetLength
        );
      }
      const removeQuotes = (str) => str.replace(/^['"](.*)['"]$/, "$1");
      const fixNewLines = (str) => str.replaceAll(/\\n/g, "\n\n");
      tweetTextForPosting = removeQuotes(
        fixNewLines(tweetTextForPosting)
      );
      if (this.isDryRun) {
        elizaLogger4.info(
          `Dry run: would have posted tweet: ${tweetTextForPosting}`
        );
        return;
      }
      try {
        if (this.approvalRequired) {
          elizaLogger4.log(
            `Sending Tweet For Approval:
 ${tweetTextForPosting}`
          );
          await this.sendForApproval(
            tweetTextForPosting,
            roomId,
            rawTweetContent
          );
          elizaLogger4.log("Tweet sent for approval");
        } else {
          elizaLogger4.log(
            `Posting new tweet:
 ${tweetTextForPosting}`
          );
          this.postTweet(
            this.runtime,
            this.client,
            tweetTextForPosting,
            roomId,
            rawTweetContent,
            mediaData
          );
        }
      } catch (error) {
        elizaLogger4.error("Error sending tweet:", error);
      }
    } catch (error) {
      console.error(error);
      elizaLogger4.error("Error generating new tweet:", error);
    }
  }
  async generateTweetContent(tweetState, options) {
    var _a;
    const context = composeContext2({
      state: tweetState,
      template: (options == null ? void 0 : options.template) || ((_a = this.runtime.character.templates) == null ? void 0 : _a.twitterPostTemplate) || twitterPostTemplate
    });
    const response = await generateText({
      runtime: this.runtime,
      context: (options == null ? void 0 : options.context) || context,
      modelClass: ModelClass2.SMALL
    });
    elizaLogger4.log("generate tweet content response:\n" + response);
    const cleanedResponse = cleanJsonResponse(response);
    const jsonResponse = parseJSONObjectFromText(cleanedResponse);
    if (jsonResponse.text) {
      const truncateContent2 = truncateToCompleteSentence(
        jsonResponse.text,
        this.client.twitterConfig.MAX_TWEET_LENGTH
      );
      return truncateContent2;
    }
    if (typeof jsonResponse === "object") {
      const possibleContent = jsonResponse.content || jsonResponse.message || jsonResponse.response;
      if (possibleContent) {
        const truncateContent2 = truncateToCompleteSentence(
          possibleContent,
          this.client.twitterConfig.MAX_TWEET_LENGTH
        );
        return truncateContent2;
      }
    }
    let truncateContent = null;
    const parsingText = extractAttributes(cleanedResponse, ["text"]).text;
    if (parsingText) {
      truncateContent = truncateToCompleteSentence(
        parsingText,
        this.client.twitterConfig.MAX_TWEET_LENGTH
      );
    }
    if (!truncateContent) {
      truncateContent = truncateToCompleteSentence(
        cleanedResponse,
        this.client.twitterConfig.MAX_TWEET_LENGTH
      );
    }
    return truncateContent;
  }
  // TODO: #TWITTER-V2-008 - Reimplement action processing using Twitter API v2
  /**
   * Processes tweet actions (likes, retweets, quotes, replies). If isDryRun is true,
   * only simulates and logs actions without making API calls.
   */
  // private async processTweetActions() {
  //     if (this.isProcessing) {
  //         elizaLogger.log("Already processing tweet actions, skipping");
  //         return null;
  //     }
  //     try {
  //         this.isProcessing = true;
  //         this.lastProcessTime = Date.now();
  //         elizaLogger.log("Processing tweet actions");
  //         await this.runtime.ensureUserExists(
  //             this.runtime.agentId,
  //             this.client.profile.username,
  //             this.runtime.character.name,
  //             "twitter"
  //         );
  //         const timelines = await this.client.fetchTimelineForActions(
  //             MAX_TIMELINES_TO_FETCH
  //         );
  //         const maxActionsProcessing =
  //             this.client.twitterConfig.MAX_ACTIONS_PROCESSING;
  //         const processedTimelines = [];
  //         for (const tweet of timelines) {
  //             try {
  //                 // Skip if we've already processed this tweet
  //                 const memory =
  //                     await this.runtime.messageManager.getMemoryById(
  //                         stringToUuid(tweet.id + "-" + this.runtime.agentId)
  //                     );
  //                 if (memory) {
  //                     elizaLogger.log(
  //                         `Already processed tweet ID: ${tweet.id}`
  //                     );
  //                     continue;
  //                 }
  //                 const roomId = stringToUuid(
  //                     tweet.conversationId + "-" + this.runtime.agentId
  //                 );
  //                 const tweetState = await this.runtime.composeState(
  //                     {
  //                         userId: this.runtime.agentId,
  //                         roomId,
  //                         agentId: this.runtime.agentId,
  //                         content: { text: "", action: "" },
  //                     },
  //                     {
  //                         twitterUserName: this.client.profile.username,
  //                         currentTweet: `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})\nText: ${tweet.text}`,
  //                     }
  //                 );
  //                 const actionContext = composeContext({
  //                     state: tweetState,
  //                     template:
  //                         this.runtime.character.templates
  //                             ?.twitterActionTemplate ||
  //                         twitterActionTemplate,
  //                 });
  //                 const actionResponse = await generateTweetActions({
  //                     runtime: this.runtime,
  //                     context: actionContext,
  //                     modelClass: ModelClass.SMALL,
  //                 });
  //                 if (!actionResponse) {
  //                     elizaLogger.log(
  //                         `No valid actions generated for tweet ${tweet.id}`
  //                     );
  //                     continue;
  //                 }
  //                 processedTimelines.push({
  //                     tweet: tweet,
  //                     actionResponse: actionResponse,
  //                     tweetState: tweetState,
  //                     roomId: roomId,
  //                 });
  //             } catch (error) {
  //                 elizaLogger.error(
  //                     `Error processing tweet ${tweet.id}:`,
  //                     error
  //                 );
  //                 continue;
  //             }
  //         }
  //         const sortProcessedTimeline = (arr: typeof processedTimelines) => {
  //             return arr.sort((a, b) => {
  //                 // Count the number of true values in the actionResponse object
  //                 const countTrue = (obj: typeof a.actionResponse) =>
  //                     Object.values(obj).filter(Boolean).length;
  //                 const countA = countTrue(a.actionResponse);
  //                 const countB = countTrue(b.actionResponse);
  //                 // Primary sort by number of true values
  //                 if (countA !== countB) {
  //                     return countB - countA;
  //                 }
  //                 // Secondary sort by the "like" property
  //                 if (a.actionResponse.like !== b.actionResponse.like) {
  //                     return a.actionResponse.like ? -1 : 1;
  //                 }
  //                 // Tertiary sort keeps the remaining objects with equal weight
  //                 return 0;
  //             });
  //         };
  //         // Sort the timeline based on the action decision score,
  //         // then slice the results according to the environment variable to limit the number of actions per cycle.
  //         const sortedTimelines = sortProcessedTimeline(
  //             processedTimelines
  //         ).slice(0, maxActionsProcessing);
  //         return this.processTimelineActions(sortedTimelines); // Return results array to indicate completion
  //     } catch (error) {
  //         elizaLogger.error("Error in processTweetActions:", error);
  //         throw error;
  //     } finally {
  //         this.isProcessing = false;
  //     }
  // }
  // TODO: #TWITTER-V2-008 - Reimplement action processing using Twitter API v2
  /**
   * Processes a list of timelines by executing the corresponding tweet actions.
   * Each timeline includes the tweet, action response, tweet state, and room context.
   * Results are returned for tracking completed actions.
   *
   * @param timelines - Array of objects containing tweet details, action responses, and state information.
   * @returns A promise that resolves to an array of results with details of executed actions.
   */
  // private async processTimelineActions(
  //     timelines: {
  //         tweet: Tweet;
  //         actionResponse: ActionResponse;
  //         tweetState: State;
  //         roomId: UUID;
  //     }[]
  // ): Promise<
  //     {
  //         tweetId: string;
  //         actionResponse: ActionResponse;
  //         executedActions: string[];
  //     }[]
  // > {
  //     const results = [];
  //     for (const timeline of timelines) {
  //         const { actionResponse, tweetState, roomId, tweet } = timeline;
  //         try {
  //             const executedActions: string[] = [];
  //             // Execute actions
  //             if (actionResponse.like) {
  //                 if (this.isDryRun) {
  //                     elizaLogger.info(
  //                         `Dry run: would have liked tweet ${tweet.id}`
  //                     );
  //                     executedActions.push("like (dry run)");
  //                 } else {
  //                     try {
  //                         await this.client.twitterClient.likeTweet(tweet.id);
  //                         executedActions.push("like");
  //                         elizaLogger.log(`Liked tweet ${tweet.id}`);
  //                     } catch (error) {
  //                         elizaLogger.error(
  //                             `Error liking tweet ${tweet.id}:`,
  //                             error
  //                         );
  //                     }
  //                 }
  //             }
  //             if (actionResponse.retweet) {
  //                 if (this.isDryRun) {
  //                     elizaLogger.info(
  //                         `Dry run: would have retweeted tweet ${tweet.id}`
  //                     );
  //                     executedActions.push("retweet (dry run)");
  //                 } else {
  //                     try {
  //                         await this.client.twitterClient.retweet(tweet.id);
  //                         executedActions.push("retweet");
  //                         elizaLogger.log(`Retweeted tweet ${tweet.id}`);
  //                     } catch (error) {
  //                         elizaLogger.error(
  //                             `Error retweeting tweet ${tweet.id}:`,
  //                             error
  //                         );
  //                     }
  //                 }
  //             }
  //             if (actionResponse.quote) {
  //                 try {
  //                     // Build conversation thread for context
  //                     const thread = await buildConversationThread(
  //                         tweet,
  //                         this.client
  //                     );
  //                     const formattedConversation = thread
  //                         .map(
  //                             (t) =>
  //                                 `@${t.username} (${new Date(
  //                                     t.timestamp * 1000
  //                                 ).toLocaleString()}): ${t.text}`
  //                         )
  //                         .join("\n\n");
  //                     // Generate image descriptions if present
  //                     const imageDescriptions = [];
  //                     if (tweet.photos?.length > 0) {
  //                         elizaLogger.log(
  //                             "Processing images in tweet for context"
  //                         );
  //                         for (const photo of tweet.photos) {
  //                             const description = await this.runtime
  //                                 .getService<IImageDescriptionService>(
  //                                     ServiceType.IMAGE_DESCRIPTION
  //                                 )
  //                                 .describeImage(photo.url);
  //                             imageDescriptions.push(description);
  //                         }
  //                     }
  //                     // Handle quoted tweet if present
  //                     let quotedContent = "";
  //                     if (tweet.quotedStatusId) {
  //                         try {
  //                             const quotedTweet =
  //                                 await this.client.twitterClient.getTweet(
  //                                     tweet.quotedStatusId
  //                                 );
  //                             if (quotedTweet) {
  //                                 quotedContent = `\nQuoted Tweet from @${quotedTweet.username}:\n${quotedTweet.text}`;
  //                             }
  //                         } catch (error) {
  //                             elizaLogger.error(
  //                                 "Error fetching quoted tweet:",
  //                                 error
  //                             );
  //                         }
  //                     }
  //                     // Compose rich state with all context
  //                     const enrichedState = await this.runtime.composeState(
  //                         {
  //                             userId: this.runtime.agentId,
  //                             roomId: stringToUuid(
  //                                 tweet.conversationId +
  //                                     "-" +
  //                                     this.runtime.agentId
  //                             ),
  //                             agentId: this.runtime.agentId,
  //                             content: {
  //                                 text: tweet.text,
  //                                 action: "QUOTE",
  //                             },
  //                         },
  //                         {
  //                             twitterUserName: this.client.profile.username,
  //                             currentPost: `From @${tweet.username}: ${tweet.text}`,
  //                             formattedConversation,
  //                             imageContext:
  //                                 imageDescriptions.length > 0
  //                                     ? `\nImages in Tweet:\n${imageDescriptions
  //                                           .map(
  //                                               (desc, i) =>
  //                                                   `Image ${i + 1}: ${desc}`
  //                                           )
  //                                           .join("\n")}`
  //                                     : "",
  //                             quotedContent,
  //                         }
  //                     );
  //                     const quoteContent = await this.generateTweetContent(
  //                         enrichedState,
  //                         {
  //                             template:
  //                                 this.runtime.character.templates
  //                                     ?.twitterMessageHandlerTemplate ||
  //                                 twitterMessageHandlerTemplate,
  //                         }
  //                     );
  //                     if (!quoteContent) {
  //                         elizaLogger.error(
  //                             "Failed to generate valid quote tweet content"
  //                         );
  //                         return;
  //                     }
  //                     elizaLogger.log(
  //                         "Generated quote tweet content:",
  //                         quoteContent
  //                     );
  //                     // Check for dry run mode
  //                     if (this.isDryRun) {
  //                         elizaLogger.info(
  //                             `Dry run: A quote tweet for tweet ID ${tweet.id} would have been posted with the following content: "${quoteContent}".`
  //                         );
  //                         executedActions.push("quote (dry run)");
  //                     } else {
  //                         // Send the tweet through request queue
  //                         const result = await this.client.requestQueue.add(
  //                             async () =>
  //                                 await this.client.twitterClient.sendQuoteTweet(
  //                                     quoteContent,
  //                                     tweet.id
  //                                 )
  //                         );
  //                         const body = await result.json();
  //                         if (
  //                             body?.data?.create_tweet?.tweet_results?.result
  //                         ) {
  //                             elizaLogger.log(
  //                                 "Successfully posted quote tweet"
  //                             );
  //                             executedActions.push("quote");
  //                             // Cache generation context for debugging
  //                             await this.runtime.cacheManager.set(
  //                                 `twitter/quote_generation_${tweet.id}.txt`,
  //                                 `Context:\n${enrichedState}\n\nGenerated Quote:\n${quoteContent}`
  //                             );
  //                         } else {
  //                             elizaLogger.error(
  //                                 "Quote tweet creation failed:",
  //                                 body
  //                             );
  //                         }
  //                     }
  //                 } catch (error) {
  //                     elizaLogger.error(
  //                         "Error in quote tweet generation:",
  //                         error
  //                     );
  //                 }
  //             }
  //             if (actionResponse.reply) {
  //                 try {
  //                     await this.handleTextOnlyReply(
  //                         tweet,
  //                         tweetState,
  //                         executedActions
  //                     );
  //                 } catch (error) {
  //                     elizaLogger.error(
  //                         `Error replying to tweet ${tweet.id}:`,
  //                         error
  //                     );
  //                 }
  //             }
  //             // Add these checks before creating memory
  //             await this.runtime.ensureRoomExists(roomId);
  //             await this.runtime.ensureUserExists(
  //                 stringToUuid(tweet.userId),
  //                 tweet.username,
  //                 tweet.name,
  //                 "twitter"
  //             );
  //             await this.runtime.ensureParticipantInRoom(
  //                 this.runtime.agentId,
  //                 roomId
  //             );
  //             if (!this.isDryRun) {
  //                 // Then create the memory
  //                 await this.runtime.messageManager.createMemory({
  //                     id: stringToUuid(tweet.id + "-" + this.runtime.agentId),
  //                     userId: stringToUuid(tweet.userId),
  //                     content: {
  //                         text: tweet.text,
  //                         url: tweet.permanentUrl,
  //                         source: "twitter",
  //                         action: executedActions.join(","),
  //                     },
  //                     agentId: this.runtime.agentId,
  //                     roomId,
  //                     embedding: getEmbeddingZeroVector(),
  //                     createdAt: tweet.timestamp * 1000,
  //                 });
  //             }
  //             results.push({
  //                 tweetId: tweet.id,
  //                 actionResponse: actionResponse,
  //                 executedActions,
  //             });
  //         } catch (error) {
  //             elizaLogger.error(`Error processing tweet ${tweet.id}:`, error);
  //             continue;
  //         }
  //     }
  //     return results;
  // }
  // TODO: #TWITTER-V2-008 - Reimplement action processing using Twitter API v2
  /**
   * Handles text-only replies to tweets. If isDryRun is true, only logs what would
   * have been replied without making API calls.
   */
  // private async handleTextOnlyReply(
  //     tweet: Tweet,
  //     tweetState: any,
  //     executedActions: string[]
  // ) {
  //     try {
  //         // Build conversation thread for context
  //         const thread = await buildConversationThread(tweet, this.client);
  //         const formattedConversation = thread
  //             .map(
  //                 (t) =>
  //                     `@${t.username} (${new Date(
  //                         t.timestamp * 1000
  //                     ).toLocaleString()}): ${t.text}`
  //             )
  //             .join("\n\n");
  //         // Generate image descriptions if present
  //         const imageDescriptions = [];
  //         if (tweet.photos?.length > 0) {
  //             elizaLogger.log("Processing images in tweet for context");
  //             for (const photo of tweet.photos) {
  //                 const description = await this.runtime
  //                     .getService<IImageDescriptionService>(
  //                         ServiceType.IMAGE_DESCRIPTION
  //                     )
  //                     .describeImage(photo.url);
  //                 imageDescriptions.push(description);
  //             }
  //         }
  //         // Handle quoted tweet if present
  //         let quotedContent = "";
  //         if (tweet.quotedStatusId) {
  //             try {
  //                 const quotedTweet =
  //                     await this.client.twitterClient.getTweet(
  //                         tweet.quotedStatusId
  //                     );
  //                 if (quotedTweet) {
  //                     quotedContent = `\nQuoted Tweet from @${quotedTweet.username}:\n${quotedTweet.text}`;
  //                 }
  //             } catch (error) {
  //                 elizaLogger.error("Error fetching quoted tweet:", error);
  //             }
  //         }
  //         // Compose rich state with all context
  //         const enrichedState = await this.runtime.composeState(
  //             {
  //                 userId: this.runtime.agentId,
  //                 roomId: stringToUuid(
  //                     tweet.conversationId + "-" + this.runtime.agentId
  //                 ),
  //                 agentId: this.runtime.agentId,
  //                 content: { text: tweet.text, action: "" },
  //             },
  //             {
  //                 twitterUserName: this.client.profile.username,
  //                 currentPost: `From @${tweet.username}: ${tweet.text}`,
  //                 formattedConversation,
  //                 imageContext:
  //                     imageDescriptions.length > 0
  //                         ? `\nImages in Tweet:\n${imageDescriptions
  //                               .map((desc, i) => `Image ${i + 1}: ${desc}`)
  //                               .join("\n")}`
  //                         : "",
  //                 quotedContent,
  //             }
  //         );
  //         // Generate and clean the reply content
  //         const replyText = await this.generateTweetContent(enrichedState, {
  //             template:
  //                 this.runtime.character.templates
  //                     ?.twitterMessageHandlerTemplate ||
  //                 twitterMessageHandlerTemplate,
  //         });
  //         if (!replyText) {
  //             elizaLogger.error("Failed to generate valid reply content");
  //             return;
  //         }
  //         if (this.isDryRun) {
  //             elizaLogger.info(
  //                 `Dry run: reply to tweet ${tweet.id} would have been: ${replyText}`
  //             );
  //             executedActions.push("reply (dry run)");
  //             return;
  //         }
  //         elizaLogger.debug("Final reply text to be sent:", replyText);
  //         let result;
  //         if (replyText.length > DEFAULT_MAX_TWEET_LENGTH) {
  //             result = await this.handleNoteTweet(
  //                 this.client,
  //                 replyText,
  //                 tweet.id
  //             );
  //         } else {
  //             result = await this.sendStandardTweet(
  //                 this.client,
  //                 replyText,
  //                 tweet.id
  //             );
  //         }
  //         if (result) {
  //             elizaLogger.log("Successfully posted reply tweet");
  //             executedActions.push("reply");
  //             // Cache generation context for debugging
  //             await this.runtime.cacheManager.set(
  //                 `twitter/reply_generation_${tweet.id}.txt`,
  //                 `Context:\n${enrichedState}\n\nGenerated Reply:\n${replyText}`
  //             );
  //         } else {
  //             elizaLogger.error("Tweet reply creation failed");
  //         }
  //     } catch (error) {
  //         elizaLogger.error("Error in handleTextOnlyReply:", error);
  //     }
  // }
  async stop() {
    this.stopProcessingActions = true;
  }
  async sendForApproval(tweetTextForPosting, roomId, rawTweetContent) {
    try {
      const embed = {
        title: "New Tweet Pending Approval",
        description: tweetTextForPosting,
        fields: [
          {
            name: "Character",
            value: this.client.profile.username,
            inline: true
          },
          {
            name: "Length",
            value: tweetTextForPosting.length.toString(),
            inline: true
          }
        ],
        footer: {
          text: "Reply with '\u{1F44D}' to post or '\u274C' to discard, This will automatically expire and remove after 24 hours if no response received"
        },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
      const channel = await this.discordClientForApproval.channels.fetch(
        this.discordApprovalChannelId
      );
      if (!channel || !(channel instanceof TextChannel)) {
        throw new Error("Invalid approval channel");
      }
      const message = await channel.send({ embeds: [embed] });
      const pendingTweetsKey = `twitter/${this.client.profile.username}/pendingTweet`;
      const currentPendingTweets = await this.runtime.cacheManager.get(
        pendingTweetsKey
      ) || [];
      currentPendingTweets.push({
        tweetTextForPosting,
        roomId,
        rawTweetContent,
        discordMessageId: message.id,
        channelId: this.discordApprovalChannelId,
        timestamp: Date.now()
      });
      await this.runtime.cacheManager.set(
        pendingTweetsKey,
        currentPendingTweets
      );
      return message.id;
    } catch (error) {
      elizaLogger4.error(
        "Error Sending Twitter Post Approval Request:",
        error
      );
      return null;
    }
  }
  async checkApprovalStatus(discordMessageId) {
    try {
      const channel = await this.discordClientForApproval.channels.fetch(
        this.discordApprovalChannelId
      );
      elizaLogger4.log(`channel ${JSON.stringify(channel)}`);
      if (!(channel instanceof TextChannel)) {
        elizaLogger4.error("Invalid approval channel");
        return "PENDING";
      }
      const message = await channel.messages.fetch(discordMessageId);
      const thumbsUpReaction = message.reactions.cache.find(
        (reaction) => reaction.emoji.name === "\u{1F44D}"
      );
      const rejectReaction = message.reactions.cache.find(
        (reaction) => reaction.emoji.name === "\u274C"
      );
      if (rejectReaction) {
        const count = rejectReaction.count;
        if (count > 0) {
          return "REJECTED";
        }
      }
      if (thumbsUpReaction) {
        const count = thumbsUpReaction.count;
        if (count > 0) {
          return "APPROVED";
        }
      }
      return "PENDING";
    } catch (error) {
      elizaLogger4.error("Error checking approval status:", error);
      return "PENDING";
    }
  }
  async cleanupPendingTweet(discordMessageId) {
    const pendingTweetsKey = `twitter/${this.client.profile.username}/pendingTweet`;
    const currentPendingTweets = await this.runtime.cacheManager.get(
      pendingTweetsKey
    ) || [];
    const updatedPendingTweets = currentPendingTweets.filter(
      (tweet) => tweet.discordMessageId !== discordMessageId
    );
    if (updatedPendingTweets.length === 0) {
      await this.runtime.cacheManager.delete(pendingTweetsKey);
    } else {
      await this.runtime.cacheManager.set(
        pendingTweetsKey,
        updatedPendingTweets
      );
    }
  }
  async handlePendingTweet() {
    elizaLogger4.log("Checking Pending Tweets...");
    const pendingTweetsKey = `twitter/${this.client.profile.username}/pendingTweet`;
    const pendingTweets = await this.runtime.cacheManager.get(
      pendingTweetsKey
    ) || [];
    for (const pendingTweet of pendingTweets) {
      const isExpired = Date.now() - pendingTweet.timestamp > 24 * 60 * 60 * 1e3;
      if (isExpired) {
        elizaLogger4.log("Pending tweet expired, cleaning up");
        try {
          const channel = await this.discordClientForApproval.channels.fetch(
            pendingTweet.channelId
          );
          if (channel instanceof TextChannel) {
            const originalMessage = await channel.messages.fetch(
              pendingTweet.discordMessageId
            );
            await originalMessage.reply(
              "This tweet approval request has expired (24h timeout)."
            );
          }
        } catch (error) {
          elizaLogger4.error(
            "Error sending expiration notification:",
            error
          );
        }
        await this.cleanupPendingTweet(pendingTweet.discordMessageId);
        return;
      }
      elizaLogger4.log("Checking approval status...");
      const approvalStatus = await this.checkApprovalStatus(pendingTweet.discordMessageId);
      if (approvalStatus === "APPROVED") {
        elizaLogger4.log("Tweet Approved, Posting");
        await this.postTweet(
          this.runtime,
          this.client,
          pendingTweet.tweetTextForPosting,
          pendingTweet.roomId,
          pendingTweet.rawTweetContent
        );
        try {
          const channel = await this.discordClientForApproval.channels.fetch(
            pendingTweet.channelId
          );
          if (channel instanceof TextChannel) {
            const originalMessage = await channel.messages.fetch(
              pendingTweet.discordMessageId
            );
            await originalMessage.reply(
              "Tweet has been posted successfully! \u2705"
            );
          }
        } catch (error) {
          elizaLogger4.error(
            "Error sending post notification:",
            error
          );
        }
        await this.cleanupPendingTweet(pendingTweet.discordMessageId);
      } else if (approvalStatus === "REJECTED") {
        elizaLogger4.log("Tweet Rejected, Cleaning Up");
        await this.cleanupPendingTweet(pendingTweet.discordMessageId);
        try {
          const channel = await this.discordClientForApproval.channels.fetch(
            pendingTweet.channelId
          );
          if (channel instanceof TextChannel) {
            const originalMessage = await channel.messages.fetch(
              pendingTweet.discordMessageId
            );
            await originalMessage.reply(
              "Tweet has been rejected! \u274C"
            );
          }
        } catch (error) {
          elizaLogger4.error(
            "Error sending rejection notification:",
            error
          );
        }
      }
    }
  }
};

// src/client.ts
var TwitterManager = class {
  client;
  post;
  // search: TwitterSearchClient;
  interaction;
  // space?: TwitterSpaceClient;
  constructor(runtime, twitterConfig) {
    this.client = new ClientBase(runtime, twitterConfig);
    this.post = new TwitterPostClient(this.client, runtime);
    this.interaction = new TwitterInteractionClient(this.client, runtime);
  }
  async stop() {
    elizaLogger5.warn("Twitter client does not support stopping yet");
  }
};
var TwitterClientInterface = {
  name: "twitter",
  async start(runtime) {
    const twitterConfig = await validateTwitterConfig(runtime);
    elizaLogger5.log("Twitter client started");
    const manager = new TwitterManager(runtime, twitterConfig);
    await manager.client.init();
    await manager.post.start();
    await manager.interaction.start();
    return manager;
  }
};

// src/index.ts
var twitterPlugin = {
  name: "twitter",
  description: "Twitter client",
  clients: [TwitterClientInterface]
};
var index_default = twitterPlugin;
export {
  index_default as default
};
//# sourceMappingURL=index.js.map