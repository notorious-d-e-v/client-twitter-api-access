import {
    type Content,
    type IAgentRuntime,
    type IImageDescriptionService,
    type Memory,
    type State,
    type UUID,
    getEmbeddingZeroVector,
    elizaLogger,
    stringToUuid,
    ActionTimelineType,
} from "@elizaos/core";
import {
    TwitterApi,
    TweetV2,
    UserV2,
    TwitterV2IncludesHelper
} from "twitter-api-v2";
import { EventEmitter } from "events";
import type { TwitterConfig } from "./environment.ts";
import type { ElizaTweet, TwitterProfile } from "./types.ts";
import { createElizaTweet } from "./utils.ts";

export function extractAnswer(text: string): string {
    const startIndex = text.indexOf("Answer: ") + 8;
    const endIndex = text.indexOf("<|endoftext|>", 11);
    return text.slice(startIndex, endIndex);
}

interface QueryTweetsResponse {
    tweets: TweetV2[];
    next?: string;
    previous?: string;
}

// create a default profile
const defaultProfile: TwitterProfile = {
    id: "",
    username: "",
    name: "",
    bio: "",
    nicknames: [],
};

class RequestQueue {
    private queue: (() => Promise<any>)[] = [];
    private processing = false;

    async add<T>(request: () => Promise<T>): Promise<T> {
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

    private async processQueue(): Promise<void> {
        if (this.processing || this.queue.length === 0) {
            return;
        }
        this.processing = true;

        while (this.queue.length > 0) {
            const request = this.queue.shift()!;
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

    private async exponentialBackoff(retryCount: number): Promise<void> {
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
    }

    private async randomDelay(): Promise<void> {
        const delay = Math.floor(Math.random() * 2000) + 1500;
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
}

export class ClientBase extends EventEmitter {
    static _twitterClients: { [accountIdentifier: string]: TwitterApi } = {};
    twitterClient: TwitterApi;
    runtime: IAgentRuntime;
    twitterConfig: TwitterConfig;
    directions: string;
    lastCheckedTweetId: bigint | null = null;
    imageDescriptionService: IImageDescriptionService;
    temperature = 0.5;

    requestQueue: RequestQueue = new RequestQueue();

    profile: TwitterProfile | null;

    async cacheTweet(tweet: TweetV2): Promise<void> {
        if (!tweet) {
            console.warn("Tweet is undefined, skipping cache");
            return;
        }

        this.runtime.cacheManager.set(`twitter/tweets/${tweet.id}`, tweet);
    }

    async getCachedTweet(tweetId: string): Promise<TweetV2 | undefined> {
        const cached = await this.runtime.cacheManager.get<TweetV2>(
            `twitter/tweets/${tweetId}`
        );

        return cached;
    }

    async getTweet(tweetId: string): Promise<TweetV2> {
        const cachedTweet = await this.getCachedTweet(tweetId);

        if (cachedTweet) {
            return cachedTweet;
        }

        // TODO replace with v2 api call
        // const tweet = await this.requestQueue.add(() =>
            // this.twitterClient.getTweet(tweetId)
        // );

        // await this.cacheTweet(tweet);
        // return tweet;
        return
    }

    callback: (self: ClientBase) => any = null;

    onReady() {
        throw new Error(
            "Not implemented in base class, please call from subclass"
        );
    }

    /**
     * Parse the raw tweet data into a standardized Tweet object.
     */
    private parseTweet(raw: any, depth = 0, maxDepth = 3): TweetV2 {
        // If we've reached maxDepth, don't parse nested quotes/retweets further
        const canRecurse = depth < maxDepth;

        const quotedStatus = raw.quoted_status_result?.result && canRecurse
            ? this.parseTweet(raw.quoted_status_result.result, depth + 1, maxDepth)
            : undefined;

        const retweetedStatus = raw.retweeted_status_result?.result && canRecurse
            ? this.parseTweet(raw.retweeted_status_result.result, depth + 1, maxDepth)
            : undefined;

        const t: TweetV2 = {
            id: "",
            text: "",
            edit_history_tweet_ids: []
        };


        return t;
    }

    constructor(runtime: IAgentRuntime, twitterConfig: TwitterConfig) {
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

        elizaLogger.info("Twitter client initialized with access token and access secret.");

        this.runtime.character.style.all.join("\n- ") +
        "- " +
        this.runtime.character.style.post.join();
    }

    async init() {
        // initialize Twitter profile of authenticated user
        this.profile = await this.fetchProfile();

        if (this.profile) {
            elizaLogger.log("Twitter user ID:", this.profile.id);
            elizaLogger.log(
                "Twitter loaded:",
                JSON.stringify(this.profile, null, 10)
            );
            // Store profile info for use in responses
            this.runtime.character.twitterProfile = {
                id: this.profile.id,
                username: this.profile.username,
                name: this.profile.name,
                bio: this.profile.bio,
                nicknames: this.profile.nicknames,
            };
        } else {
            throw new Error("Failed to load profile");
        }
    }

    async fetchOwnPosts(count: number): Promise<TweetV2[]> {
        elizaLogger.debug("fetching own posts");
        // TODO replace with v2 api call
        // const homeTimeline = await this.twitterClient.getUserTweets(
        //     this.profile.id,
        //     count
        // );
        // // Use parseTweet on each tweet
        // return homeTimeline.tweets.map((t) => this.parseTweet(t));
        return [];
    }

    /**
     * Fetch timeline for twitter account, optionally only from followed accounts
     */
    async fetchHomeTimeline(
        count: number,
        following?: boolean
    ): Promise<TweetV2[]> {
        elizaLogger.debug("fetching home timeline");
        // TODO replace with v2 api call
        // const homeTimeline = following
        //     ? await this.twitterClient.fetchFollowingTimeline(count, [])
        //     : await this.twitterClient.fetchHomeTimeline(count, []);

        // elizaLogger.debug(homeTimeline, { depth: Number.POSITIVE_INFINITY });
        // const processedTimeline = homeTimeline
        //     .filter((t) => t.__typename !== "TweetWithVisibilityResults") // what's this about?
        //     .map((tweet) => this.parseTweet(tweet));

        // //elizaLogger.debug("process homeTimeline", processedTimeline);
        // return processedTimeline;
        return [];
    }

    async fetchTimelineForActions(count: number): Promise<TweetV2[]> {
        elizaLogger.debug("fetching timeline for actions");

        // TODO replace with v2 api call
        // const agentUsername = this.twitterConfig.TWITTER_USERNAME;

        // const homeTimeline =
        //     this.twitterConfig.ACTION_TIMELINE_TYPE ===
        //     ActionTimelineType.Following
        //         ? await this.twitterClient.fetchFollowingTimeline(count, [])
        //         : await this.twitterClient.fetchHomeTimeline(count, []);

        // // Parse, filter out self-tweets, limit to count
        // return homeTimeline
        //     .map((tweet) => this.parseTweet(tweet))
        //     .filter((tweet) => tweet.username !== agentUsername) // do not perform action on self-tweets
        //     .slice(0, count);
        // TODO: Once the 'count' parameter is fixed in the 'fetchTimeline' method of the 'agent-twitter-client',
        // this workaround can be removed.
        // Related issue: https://github.com/elizaos/agent-twitter-client/issues/43
        return [];
    }

    async fetchSearchTweets(
        query: string,
        maxTweets: number,
        // searchMode: SearchMode,
        cursor?: string
    ): Promise<QueryTweetsResponse> {
        try {
            // Sometimes this fails because we are rate limited. in this case, we just need to return an empty array
            // if we dont get a response in 5 seconds, something is wrong
            const timeoutPromise = new Promise((resolve) =>
                setTimeout(() => resolve({ tweets: [] }), 15000)
            );

            try {
                const result = await this.requestQueue.add(
                    // TODO replace with v2 api call 
                    // async () =>
                    //     await Promise.race([
                    //         this.twitterClient.fetchSearchTweets(
                    //             query,
                    //             maxTweets,
                    //             searchMode,
                    //             cursor
                    //         ),
                    //         timeoutPromise,
                    //     ])
                );
                return (result ?? { tweets: [] }) as QueryTweetsResponse;
            } catch (error) {
                elizaLogger.error("Error fetching search tweets:", error);
                return { tweets: [] };
            }
        } catch (error) {
            elizaLogger.error("Error fetching search tweets:", error);
            return { tweets: [] };
        }
    }

    async getMentions(userId: string, count: number): Promise<ElizaTweet[]> {
        elizaLogger.debug("fetching mentions");
        const mentions = await this.twitterClient.v2.userMentionTimeline(userId, {
            max_results: count,
            "tweet.fields": "created_at,author_id,conversation_id,entities,referenced_tweets,text",
            "expansions": "author_id,referenced_tweets.id"
        });
        
        return mentions.tweets.map((tweet) => createElizaTweet(tweet, mentions.includes));
    }

    private async populateTimeline() {
        elizaLogger.debug("populating timeline...");

        const cachedTimeline = await this.getCachedTimeline();

        // Check if the cache file exists
        if (cachedTimeline) {
            // Read the cached search results from the file

            // Get the existing memories from the database
            const existingMemories =
                await this.runtime.messageManager.getMemoriesByRoomIds({
                    roomIds: cachedTimeline.map((tweet) =>
                        stringToUuid(
                            tweet.conversationId + "-" + this.runtime.agentId
                        )
                    ),
                });

            //TODO: load tweets not in cache?

            // Create a Set to store the IDs of existing memories
            const existingMemoryIds = new Set(
                existingMemories.map((memory) => memory.id.toString())
            );

            // Check if any of the cached tweets exist in the existing memories
            const someCachedTweetsExist = cachedTimeline.some((tweet) =>
                existingMemoryIds.has(
                    stringToUuid(tweet.id + "-" + this.runtime.agentId)
                )
            );

            if (someCachedTweetsExist) {
                // Filter out the cached tweets that already exist in the database
                const tweetsToSave = cachedTimeline.filter(
                    (tweet) =>
                        !existingMemoryIds.has(
                            stringToUuid(tweet.id + "-" + this.runtime.agentId)
                        )
                );

                console.log({
                    processingTweets: tweetsToSave
                        .map((tweet) => tweet.id)
                        .join(","),
                });

                // Save the missing tweets as memories
                for (const tweet of tweetsToSave) {
                    elizaLogger.log("Saving Tweet", tweet.id);

                    const roomId = stringToUuid(
                        tweet.conversationId + "-" + this.runtime.agentId
                    );

                    const userId =
                        tweet.userId === this.profile.id
                            ? this.runtime.agentId
                            : stringToUuid(tweet.userId);

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
                        inReplyTo: tweet.inReplyToStatusId
                            ? stringToUuid(
                                  tweet.inReplyToStatusId +
                                      "-" +
                                      this.runtime.agentId
                              )
                            : undefined,
                    } as Content;

                    elizaLogger.log("Creating memory for tweet", tweet.id);

                    // check if it already exists
                    const memory =
                        await this.runtime.messageManager.getMemoryById(
                            stringToUuid(tweet.id + "-" + this.runtime.agentId)
                        );

                    if (memory) {
                        elizaLogger.log(
                            "Memory already exists, skipping timeline population"
                        );
                        break;
                    }

                    await this.runtime.messageManager.createMemory({
                        id: stringToUuid(tweet.id + "-" + this.runtime.agentId),
                        userId,
                        content: content,
                        agentId: this.runtime.agentId,
                        roomId,
                        embedding: getEmbeddingZeroVector(),
                        createdAt: tweet.timestamp * 1000,
                    });

                    await this.cacheTweet(tweet);
                }

                elizaLogger.log(
                    `Populated ${tweetsToSave.length} missing tweets from the cache.`
                );
                return;
            }
        }

        const timeline = await this.fetchHomeTimeline(cachedTimeline ? 10 : 50);
        const username = this.profile?.username;

        // Get the most recent 20 mentions and interactions
        const mentionsAndInteractions = await this.fetchSearchTweets(
            `@${username}`,
            20,
            // SearchMode.Latest
        );

        // Combine the timeline tweets and mentions/interactions
        const allTweets = [...timeline, ...mentionsAndInteractions.tweets];

        // Create a Set to store unique tweet IDs
        const tweetIdsToCheck = new Set<string>();
        const roomIds = new Set<UUID>();

        // Add tweet IDs to the Set
        for (const tweet of allTweets) {
            tweetIdsToCheck.add(tweet.id);
            roomIds.add(
                stringToUuid(tweet.conversationId + "-" + this.runtime.agentId)
            );
        }

        // Check the existing memories in the database
        const existingMemories =
            await this.runtime.messageManager.getMemoriesByRoomIds({
                roomIds: Array.from(roomIds),
            });

        // Create a Set to store the existing memory IDs
        const existingMemoryIds = new Set<UUID>(
            existingMemories.map((memory) => memory.id)
        );

        // Filter out the tweets that already exist in the database
        const tweetsToSave = allTweets.filter(
            (tweet) =>
                !existingMemoryIds.has(
                    stringToUuid(tweet.id + "-" + this.runtime.agentId)
                )
        );

        elizaLogger.debug({
            processingTweets: tweetsToSave.map((tweet) => tweet.id).join(","),
        });

        await this.runtime.ensureUserExists(
            this.runtime.agentId,
            this.profile.username,
            this.runtime.character.name,
            "twitter"
        );

        // Save the new tweets as memories
        for (const tweet of tweetsToSave) {
            elizaLogger.log("Saving Tweet", tweet.id);

            const roomId = stringToUuid(
                tweet.conversationId + "-" + this.runtime.agentId
            );
            const userId =
                tweet.userId === this.profile.id
                    ? this.runtime.agentId
                    : stringToUuid(tweet.userId);

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
                inReplyTo: tweet.inReplyToStatusId
                    ? stringToUuid(tweet.inReplyToStatusId)
                    : undefined,
            } as Content;

            await this.runtime.messageManager.createMemory({
                id: stringToUuid(tweet.id + "-" + this.runtime.agentId),
                userId,
                content: content,
                agentId: this.runtime.agentId,
                roomId,
                embedding: getEmbeddingZeroVector(),
                createdAt: tweet.timestamp * 1000,
            });

            await this.cacheTweet(tweet);
        }

        // Cache
        await this.cacheTimeline(timeline);
        await this.cacheMentions(mentionsAndInteractions.tweets);
    }

    async setCookiesFromArray(cookiesArray: any[]) {
        const cookieStrings = cookiesArray.map(
            (cookie) =>
                `${cookie.key}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}; ${
                    cookie.secure ? "Secure" : ""
                }; ${cookie.httpOnly ? "HttpOnly" : ""}; SameSite=${
                    cookie.sameSite || "Lax"
                }`
        );
        await this.twitterClient.setCookies(cookieStrings);
    }

    async saveRequestMessage(message: Memory, state: State) {
        if (message.content.text) {
            const recentMessage = await this.runtime.messageManager.getMemories(
                {
                    roomId: message.roomId,
                    count: 1,
                    unique: false,
                }
            );

            if (
                recentMessage.length > 0 &&
                recentMessage[0].content === message.content
            ) {
                elizaLogger.debug("Message already saved", recentMessage[0].id);
            } else {
                await this.runtime.messageManager.createMemory({
                    ...message,
                    embedding: getEmbeddingZeroVector(),
                });
            }

            await this.runtime.evaluate(message, {
                ...state,
                twitterClient: this.twitterClient,
            });
        }
    }

    async loadLatestCheckedTweetId(): Promise<void> {
        const latestCheckedTweetId =
            await this.runtime.cacheManager.get<string>(
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

    async getCachedTimeline(): Promise<Tweet[] | undefined> {
        return await this.runtime.cacheManager.get<Tweet[]>(
            `twitter/${this.profile.username}/timeline`
        );
    }

    async cacheTimeline(timeline: Tweet[]) {
        await this.runtime.cacheManager.set(
            `twitter/${this.profile.username}/timeline`,
            timeline,
            { expires: Date.now() + 10 * 1000 }
        );
    }

    async cacheMentions(mentions: Tweet[]) {
        await this.runtime.cacheManager.set(
            `twitter/${this.profile.username}/mentions`,
            mentions,
            { expires: Date.now() + 10 * 1000 }
        );
    }

    async getCachedCookies(username: string) {
        return await this.runtime.cacheManager.get<any[]>(
            `twitter/${username}/cookies`
        );
    }

    async cacheCookies(username: string, cookies: any[]) {
        await this.runtime.cacheManager.set(
            `twitter/${username}/cookies`,
            cookies
        );
    }

    async getAuthenticatedUserData(): Promise<UserV2> {
        try {
            const user = await this.requestQueue.add(async () => {
                return await this.twitterClient.v2.me({
                    'user.fields': 'description',
                });
            });
            
            elizaLogger.debug("Authenticated User's data:", user);
            
            return user.data;
        } catch (error) {
            elizaLogger.error('Error fetching authenticated user info:', error);
            throw error;
        }
    }

    async fetchProfile(): Promise<TwitterProfile> {
        elizaLogger.info("Fetching profile of authenticated user.");
        const userData = await this.getAuthenticatedUserData();

        return {
            id: userData.id,
            username: userData.username,
            name: userData.name,
            bio: userData.description,
            nicknames: [],
        };
    }
}
