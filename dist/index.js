// src/client.ts
import { elizaLogger as elizaLogger5 } from "@elizaos/core";

// src/base.ts
import {
  getEmbeddingZeroVector,
  elizaLogger,
  stringToUuid
} from "@elizaos/core";
import {
  TwitterApi
} from "twitter-api-v2";
import { EventEmitter } from "events";
var defaultProfile = {
  id: "",
  username: "",
  screenName: "",
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
    return;
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
    elizaLogger.info("Twitter client initialized with access token and access secret.");
    this.runtime.character.style.all.join("\n- ") + "- " + this.runtime.character.style.post.join();
  }
  async init() {
    this.profile = await this.fetchProfile();
    if (this.profile) {
      elizaLogger.log("Twitter user ID:", this.profile.id);
      elizaLogger.log(
        "Twitter loaded:",
        JSON.stringify(this.profile, null, 10)
      );
      this.runtime.character.twitterProfile = {
        id: this.profile.id,
        username: this.profile.username,
        screenName: this.profile.screenName,
        bio: this.profile.bio,
        nicknames: this.profile.nicknames
      };
    } else {
      throw new Error("Failed to load profile");
    }
  }
  async fetchOwnPosts(count) {
    elizaLogger.debug("fetching own posts");
    return [];
  }
  /**
   * Fetch timeline for twitter account, optionally only from followed accounts
   */
  async fetchHomeTimeline(count, following) {
    elizaLogger.debug("fetching home timeline");
    return [];
  }
  async fetchTimelineForActions(count) {
    elizaLogger.debug("fetching timeline for actions");
    return [];
  }
  async fetchSearchTweets(query, maxTweets, cursor) {
    try {
      const timeoutPromise = new Promise(
        (resolve) => setTimeout(() => resolve({ tweets: [] }), 15e3)
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
        return result ?? { tweets: [] };
      } catch (error) {
        elizaLogger.error("Error fetching search tweets:", error);
        return { tweets: [] };
      }
    } catch (error) {
      elizaLogger.error("Error fetching search tweets:", error);
      return { tweets: [] };
    }
  }
  async populateTimeline() {
    var _a;
    elizaLogger.debug("populating timeline...");
    const cachedTimeline = await this.getCachedTimeline();
    if (cachedTimeline) {
      const existingMemories2 = await this.runtime.messageManager.getMemoriesByRoomIds({
        roomIds: cachedTimeline.map(
          (tweet) => stringToUuid(
            tweet.conversationId + "-" + this.runtime.agentId
          )
        )
      });
      const existingMemoryIds2 = new Set(
        existingMemories2.map((memory) => memory.id.toString())
      );
      const someCachedTweetsExist = cachedTimeline.some(
        (tweet) => existingMemoryIds2.has(
          stringToUuid(tweet.id + "-" + this.runtime.agentId)
        )
      );
      if (someCachedTweetsExist) {
        const tweetsToSave2 = cachedTimeline.filter(
          (tweet) => !existingMemoryIds2.has(
            stringToUuid(tweet.id + "-" + this.runtime.agentId)
          )
        );
        console.log({
          processingTweets: tweetsToSave2.map((tweet) => tweet.id).join(",")
        });
        for (const tweet of tweetsToSave2) {
          elizaLogger.log("Saving Tweet", tweet.id);
          const roomId = stringToUuid(
            tweet.conversationId + "-" + this.runtime.agentId
          );
          const userId = tweet.userId === this.profile.id ? this.runtime.agentId : stringToUuid(tweet.userId);
          if (tweet.userId === this.profile.id) {
            await this.runtime.ensureConnection(
              this.runtime.agentId,
              roomId,
              this.profile.username,
              this.profile.screenName,
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
            inReplyTo: tweet.inReplyToStatusId ? stringToUuid(
              tweet.inReplyToStatusId + "-" + this.runtime.agentId
            ) : void 0
          };
          elizaLogger.log("Creating memory for tweet", tweet.id);
          const memory = await this.runtime.messageManager.getMemoryById(
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
            content,
            agentId: this.runtime.agentId,
            roomId,
            embedding: getEmbeddingZeroVector(),
            createdAt: tweet.timestamp * 1e3
          });
          await this.cacheTweet(tweet);
        }
        elizaLogger.log(
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
        stringToUuid(tweet.conversationId + "-" + this.runtime.agentId)
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
        stringToUuid(tweet.id + "-" + this.runtime.agentId)
      )
    );
    elizaLogger.debug({
      processingTweets: tweetsToSave.map((tweet) => tweet.id).join(",")
    });
    await this.runtime.ensureUserExists(
      this.runtime.agentId,
      this.profile.username,
      this.runtime.character.name,
      "twitter"
    );
    for (const tweet of tweetsToSave) {
      elizaLogger.log("Saving Tweet", tweet.id);
      const roomId = stringToUuid(
        tweet.conversationId + "-" + this.runtime.agentId
      );
      const userId = tweet.userId === this.profile.id ? this.runtime.agentId : stringToUuid(tweet.userId);
      if (tweet.userId === this.profile.id) {
        await this.runtime.ensureConnection(
          this.runtime.agentId,
          roomId,
          this.profile.username,
          this.profile.screenName,
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
        inReplyTo: tweet.inReplyToStatusId ? stringToUuid(tweet.inReplyToStatusId) : void 0
      };
      await this.runtime.messageManager.createMemory({
        id: stringToUuid(tweet.id + "-" + this.runtime.agentId),
        userId,
        content,
        agentId: this.runtime.agentId,
        roomId,
        embedding: getEmbeddingZeroVector(),
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
        elizaLogger.debug("Message already saved", recentMessage[0].id);
      } else {
        await this.runtime.messageManager.createMemory({
          ...message,
          embedding: getEmbeddingZeroVector()
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
      elizaLogger.debug("Authenticated User's data:", user);
      return user.data;
    } catch (error) {
      elizaLogger.error("Error fetching authenticated user info:", error);
      throw error;
    }
  }
  async fetchProfile() {
    elizaLogger.info("Fetching profile of authenticated user.");
    const userData = await this.getAuthenticatedUserData();
    return {
      id: userData.id,
      username: userData.username,
      screenName: userData.name,
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
      TWITTER_APP_KEY: runtime.getSetting("TWITTER_APP_KEY") || process.env.TWITTER_APP_KEY || "",
      TWITTER_APP_SECRET: runtime.getSetting("TWITTER_APP_SECRET") || process.env.TWITTER_APP_SECRET || "",
      TWITTER_ACCESS_TOKEN: runtime.getSetting("TWITTER_ACCESS_TOKEN") || process.env.TWITTER_ACCESS_TOKEN || "",
      TWITTER_ACCESS_SECRET: runtime.getSetting("TWITTER_ACCESS_SECRET") || process.env.TWITTER_ACCESS_SECRET || "",
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

// src/post.ts
import {
  TwitterV2IncludesHelper
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
  cleanJsonResponse
} from "@elizaos/core";
import { elizaLogger as elizaLogger4 } from "@elizaos/core";
import { postActionResponseFooter } from "@elizaos/core";
import { generateTweetActions } from "@elizaos/core";
import { ServiceType as ServiceType2 } from "@elizaos/core";

// src/utils.ts
import { getEmbeddingZeroVector as getEmbeddingZeroVector2 } from "@elizaos/core";
import { stringToUuid as stringToUuid2 } from "@elizaos/core";
import { elizaLogger as elizaLogger2 } from "@elizaos/core";
import fs from "fs";
import path from "path";
async function buildConversationThread(tweet, client, maxReplies = 10) {
  const thread = [];
  const visited = /* @__PURE__ */ new Set();
  async function processThread(currentTweet, depth = 0) {
    var _a;
    elizaLogger2.debug("Processing tweet:", {
      id: currentTweet.id,
      inReplyToStatusId: currentTweet.inReplyToStatusId,
      depth
    });
    if (!currentTweet) {
      elizaLogger2.debug("No current tweet found for thread building");
      return;
    }
    if (depth >= maxReplies) {
      elizaLogger2.debug("Reached maximum reply depth", depth);
      return;
    }
    const memory = await client.runtime.messageManager.getMemoryById(
      stringToUuid2(currentTweet.id + "-" + client.runtime.agentId)
    );
    if (!memory) {
      const roomId = stringToUuid2(
        currentTweet.conversationId + "-" + client.runtime.agentId
      );
      const userId = stringToUuid2(currentTweet.userId);
      await client.runtime.ensureConnection(
        userId,
        roomId,
        currentTweet.username,
        currentTweet.name,
        "twitter"
      );
      await client.runtime.messageManager.createMemory({
        id: stringToUuid2(
          currentTweet.id + "-" + client.runtime.agentId
        ),
        agentId: client.runtime.agentId,
        content: {
          text: currentTweet.text,
          source: "twitter",
          url: currentTweet.permanentUrl,
          imageUrls: currentTweet.photos.map((p) => p.url) || [],
          inReplyTo: currentTweet.inReplyToStatusId ? stringToUuid2(
            currentTweet.inReplyToStatusId + "-" + client.runtime.agentId
          ) : void 0
        },
        createdAt: currentTweet.timestamp * 1e3,
        roomId,
        userId: currentTweet.userId === client.profile.id ? client.runtime.agentId : stringToUuid2(currentTweet.userId),
        embedding: getEmbeddingZeroVector2()
      });
    }
    if (visited.has(currentTweet.id)) {
      elizaLogger2.debug("Already visited tweet:", currentTweet.id);
      return;
    }
    visited.add(currentTweet.id);
    thread.unshift(currentTweet);
    elizaLogger2.debug("Current thread state:", {
      length: thread.length,
      currentDepth: depth,
      tweetId: currentTweet.id
    });
    if (currentTweet.inReplyToStatusId) {
      elizaLogger2.debug(
        "Fetching parent tweet:",
        currentTweet.inReplyToStatusId
      );
      try {
        const parentTweet = await client.twitterClient.getTweet(
          currentTweet.inReplyToStatusId
        );
        if (parentTweet) {
          elizaLogger2.debug("Found parent tweet:", {
            id: parentTweet.id,
            text: (_a = parentTweet.text) == null ? void 0 : _a.slice(0, 50)
          });
          await processThread(parentTweet, depth + 1);
        } else {
          elizaLogger2.debug(
            "No parent tweet found for:",
            currentTweet.inReplyToStatusId
          );
        }
      } catch (error) {
        elizaLogger2.error("Error fetching parent tweet:", {
          tweetId: currentTweet.inReplyToStatusId,
          error
        });
      }
    } else {
      elizaLogger2.debug(
        "Reached end of reply chain at:",
        currentTweet.id
      );
    }
  }
  await processThread(tweet, 0);
  elizaLogger2.debug("Final thread built:", {
    totalTweets: thread.length,
    tweetIds: thread.map((t) => {
      var _a;
      return {
        id: t.id,
        text: (_a = t.text) == null ? void 0 : _a.slice(0, 50)
      };
    })
  });
  return thread;
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

// src/post.ts
var MAX_TIMELINES_TO_FETCH = 15;
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
  // private discordClientForApproval: Client;
  // private approvalRequired = false;
  // private discordApprovalChannelId: string;
  // private approvalCheckInterval: number;
  constructor(client, runtime) {
    var _a;
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
  }
  // private setupDiscordClient() {
  //     this.discordClientForApproval = new Client({
  //         intents: [
  //             GatewayIntentBits.Guilds,
  //             GatewayIntentBits.GuildMessages,
  //             GatewayIntentBits.MessageContent,
  //             GatewayIntentBits.GuildMessageReactions,
  //         ],
  //         partials: [Partials.Channel, Partials.Message, Partials.Reaction],
  //     });
  //     this.discordClientForApproval.once(
  //         Events.ClientReady,
  //         (readyClient) => {
  //             elizaLogger.log(
  //                 `Discord bot is ready as ${readyClient.user.tag}!`
  //             );
  //             // Generate invite link with required permissions
  //             const invite = `https://discord.com/api/oauth2/authorize?client_id=${readyClient.user.id}&permissions=274877991936&scope=bot`;
  //             // 274877991936 includes permissions for:
  //             // - Send Messages
  //             // - Read Messages/View Channels
  //             // - Read Message History
  //             elizaLogger.log(
  //                 `Use this link to properly invite the Twitter Post Approval Discord bot: ${invite}`
  //             );
  //         }
  //     );
  //     // Login to Discord
  //     this.discordClientForApproval.login(
  //         this.runtime.getSetting("TWITTER_APPROVAL_DISCORD_BOT_TOKEN")
  //     );
  // }
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
    const processActionsLoop = async () => {
      const actionInterval = this.client.twitterConfig.ACTION_INTERVAL;
      while (!this.stopProcessingActions) {
        try {
          const results = await this.processTweetActions();
          if (results) {
            elizaLogger4.log(`Processed ${results.length} tweets`);
            elizaLogger4.log(
              `Next action processing scheduled in ${actionInterval} minutes`
            );
            await new Promise(
              (resolve) => setTimeout(resolve, actionInterval * 60 * 1e3)
              // now in minutes
            );
          }
        } catch (error) {
          elizaLogger4.error(
            "Error in action processing loop:",
            error
          );
          await new Promise((resolve) => setTimeout(resolve, 3e4));
        }
      }
    };
    if (this.client.twitterConfig.POST_IMMEDIATELY) {
      await this.generateNewTweet();
    }
    if (this.client.twitterConfig.ENABLE_TWITTER_POST_GENERATION) {
      generateNewTweetLoop();
      elizaLogger4.log("Tweet generation loop started");
    }
    if (this.client.twitterConfig.ENABLE_ACTION_PROCESSING) {
      processActionsLoop().catch((error) => {
        elizaLogger4.error(
          "Fatal error in process actions loop:",
          error
        );
      });
    }
  }
  // private runPendingTweetCheckLoop() {
  //     setInterval(async () => {
  //         await this.handlePendingTweet();
  //     }, this.approvalCheckInterval);
  // }
  createTweetObject(fetchedTweetResult, twitterUsername) {
    var _a, _b, _c, _d;
    const includes = new TwitterV2IncludesHelper(fetchedTweetResult);
    const author = includes.author(fetchedTweetResult.data);
    const tweetRepliedTo = includes.repliedTo(fetchedTweetResult.data);
    elizaLogger4.debug("author:\n" + JSON.stringify(author, null, 2));
    elizaLogger4.debug("tweetRepliedTo:\n" + JSON.stringify(tweetRepliedTo, null, 2));
    const tweet = {
      id: author.id,
      name: author.name,
      username: author.username,
      text: fetchedTweetResult.data.text,
      conversationId: fetchedTweetResult.data.conversation_id,
      createdAt: fetchedTweetResult.data.created_at ? new Date(fetchedTweetResult.data.created_at).getTime() : null,
      timestamp: fetchedTweetResult.data.created_at ? new Date(fetchedTweetResult.data.created_at).getTime() : null,
      userId: author.id,
      inReplyToStatusId: (tweetRepliedTo == null ? void 0 : tweetRepliedTo.id) || void 0,
      permanentUrl: `https://x.com/${twitterUsername}/status/${fetchedTweetResult.data.id}`,
      hashtags: ((_b = (_a = fetchedTweetResult.data.entities) == null ? void 0 : _a.hashtags) == null ? void 0 : _b.map((hashtag) => hashtag.text)) || [],
      mentions: ((_d = (_c = fetchedTweetResult.data.entities) == null ? void 0 : _c.mentions) == null ? void 0 : _d.map((mention) => mention.username)) || [],
      photos: [],
      thread: [],
      urls: [],
      videos: []
    };
    elizaLogger4.debug("tweet:\n" + JSON.stringify(tweet, null, 2));
    return tweet;
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
  async handleNoteTweet(client, content, tweetId, mediaData) {
    try {
      const noteTweetResult = await client.requestQueue.add(
        async () => await client.twitterClient.sendNoteTweet(
          content,
          tweetId,
          mediaData
        )
      );
      if (noteTweetResult.errors && noteTweetResult.errors.length > 0) {
        const truncateContent = truncateToCompleteSentence(
          content,
          this.client.twitterConfig.MAX_TWEET_LENGTH
        );
        return await this.sendStandardTweet(
          client,
          truncateContent,
          tweetId
        );
      } else {
        return noteTweetResult.data.notetweet_create.tweet_results.result;
      }
    } catch (error) {
      throw new Error(`Note Tweet failed: ${error}`);
    }
  }
  async sendStandardTweet(client, content, tweetId, mediaData) {
    try {
      const standardTweetResult = await client.requestQueue.add(
        async () => {
          const payload = {
            text: content
          };
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
      throw error;
    }
  }
  async postTweet(runtime, client, tweetTextForPosting, roomId, rawTweetContent, twitterUsername, mediaData) {
    try {
      elizaLogger4.log(`Posting new tweet:
`);
      let result;
      if (tweetTextForPosting.length > DEFAULT_MAX_TWEET_LENGTH) {
        result = await this.handleNoteTweet(
          client,
          tweetTextForPosting,
          void 0,
          mediaData
        );
      } else {
        result = await this.sendStandardTweet(
          client,
          tweetTextForPosting,
          void 0,
          mediaData
        );
      }
      const fetchedTweet = await this.client.requestQueue.add(
        async () => await client.twitterClient.v2.singleTweet(result.id, {
          "tweet.fields": "created_at,author_id,conversation_id,entities,referenced_tweets,text",
          "expansions": "author_id,referenced_tweets.id"
        })
      );
      elizaLogger4.debug("fetchedTweet:\n" + JSON.stringify(fetchedTweet, null, 2));
      const tweet = this.createTweetObject(
        fetchedTweet,
        twitterUsername
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
            this.client.profile.username,
            mediaData
          );
        }
      } catch (error) {
        elizaLogger4.error("Error sending tweet:", error);
      }
    } catch (error) {
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
  /**
   * Processes tweet actions (likes, retweets, quotes, replies). If isDryRun is true,
   * only simulates and logs actions without making API calls.
   */
  async processTweetActions() {
    var _a;
    if (this.isProcessing) {
      elizaLogger4.log("Already processing tweet actions, skipping");
      return null;
    }
    try {
      this.isProcessing = true;
      this.lastProcessTime = Date.now();
      elizaLogger4.log("Processing tweet actions");
      await this.runtime.ensureUserExists(
        this.runtime.agentId,
        this.client.profile.username,
        this.runtime.character.name,
        "twitter"
      );
      const timelines = await this.client.fetchTimelineForActions(
        MAX_TIMELINES_TO_FETCH
      );
      const maxActionsProcessing = this.client.twitterConfig.MAX_ACTIONS_PROCESSING;
      const processedTimelines = [];
      for (const tweet of timelines) {
        try {
          const memory = await this.runtime.messageManager.getMemoryById(
            stringToUuid4(tweet.id + "-" + this.runtime.agentId)
          );
          if (memory) {
            elizaLogger4.log(
              `Already processed tweet ID: ${tweet.id}`
            );
            continue;
          }
          const roomId = stringToUuid4(
            tweet.conversationId + "-" + this.runtime.agentId
          );
          const tweetState = await this.runtime.composeState(
            {
              userId: this.runtime.agentId,
              roomId,
              agentId: this.runtime.agentId,
              content: { text: "", action: "" }
            },
            {
              twitterUserName: this.client.profile.username,
              currentTweet: `ID: ${tweet.id}
From: ${tweet.name} (@${tweet.username})
Text: ${tweet.text}`
            }
          );
          const actionContext = composeContext2({
            state: tweetState,
            template: ((_a = this.runtime.character.templates) == null ? void 0 : _a.twitterActionTemplate) || twitterActionTemplate
          });
          const actionResponse = await generateTweetActions({
            runtime: this.runtime,
            context: actionContext,
            modelClass: ModelClass2.SMALL
          });
          if (!actionResponse) {
            elizaLogger4.log(
              `No valid actions generated for tweet ${tweet.id}`
            );
            continue;
          }
          processedTimelines.push({
            tweet,
            actionResponse,
            tweetState,
            roomId
          });
        } catch (error) {
          elizaLogger4.error(
            `Error processing tweet ${tweet.id}:`,
            error
          );
          continue;
        }
      }
      const sortProcessedTimeline = (arr) => {
        return arr.sort((a, b) => {
          const countTrue = (obj) => Object.values(obj).filter(Boolean).length;
          const countA = countTrue(a.actionResponse);
          const countB = countTrue(b.actionResponse);
          if (countA !== countB) {
            return countB - countA;
          }
          if (a.actionResponse.like !== b.actionResponse.like) {
            return a.actionResponse.like ? -1 : 1;
          }
          return 0;
        });
      };
      const sortedTimelines = sortProcessedTimeline(
        processedTimelines
      ).slice(0, maxActionsProcessing);
      return this.processTimelineActions(sortedTimelines);
    } catch (error) {
      elizaLogger4.error("Error in processTweetActions:", error);
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }
  /**
   * Processes a list of timelines by executing the corresponding tweet actions.
   * Each timeline includes the tweet, action response, tweet state, and room context.
   * Results are returned for tracking completed actions.
   *
   * @param timelines - Array of objects containing tweet details, action responses, and state information.
   * @returns A promise that resolves to an array of results with details of executed actions.
   */
  async processTimelineActions(timelines) {
    var _a, _b, _c, _d, _e;
    const results = [];
    for (const timeline of timelines) {
      const { actionResponse, tweetState, roomId, tweet } = timeline;
      try {
        const executedActions = [];
        if (actionResponse.like) {
          if (this.isDryRun) {
            elizaLogger4.info(
              `Dry run: would have liked tweet ${tweet.id}`
            );
            executedActions.push("like (dry run)");
          } else {
            try {
              await this.client.twitterClient.likeTweet(tweet.id);
              executedActions.push("like");
              elizaLogger4.log(`Liked tweet ${tweet.id}`);
            } catch (error) {
              elizaLogger4.error(
                `Error liking tweet ${tweet.id}:`,
                error
              );
            }
          }
        }
        if (actionResponse.retweet) {
          if (this.isDryRun) {
            elizaLogger4.info(
              `Dry run: would have retweeted tweet ${tweet.id}`
            );
            executedActions.push("retweet (dry run)");
          } else {
            try {
              await this.client.twitterClient.retweet(tweet.id);
              executedActions.push("retweet");
              elizaLogger4.log(`Retweeted tweet ${tweet.id}`);
            } catch (error) {
              elizaLogger4.error(
                `Error retweeting tweet ${tweet.id}:`,
                error
              );
            }
          }
        }
        if (actionResponse.quote) {
          try {
            const thread = await buildConversationThread(
              tweet,
              this.client
            );
            const formattedConversation = thread.map(
              (t) => `@${t.username} (${new Date(
                t.timestamp * 1e3
              ).toLocaleString()}): ${t.text}`
            ).join("\n\n");
            const imageDescriptions = [];
            if (((_a = tweet.photos) == null ? void 0 : _a.length) > 0) {
              elizaLogger4.log(
                "Processing images in tweet for context"
              );
              for (const photo of tweet.photos) {
                const description = await this.runtime.getService(
                  ServiceType2.IMAGE_DESCRIPTION
                ).describeImage(photo.url);
                imageDescriptions.push(description);
              }
            }
            let quotedContent = "";
            if (tweet.quotedStatusId) {
              try {
                const quotedTweet = await this.client.twitterClient.getTweet(
                  tweet.quotedStatusId
                );
                if (quotedTweet) {
                  quotedContent = `
Quoted Tweet from @${quotedTweet.username}:
${quotedTweet.text}`;
                }
              } catch (error) {
                elizaLogger4.error(
                  "Error fetching quoted tweet:",
                  error
                );
              }
            }
            const enrichedState = await this.runtime.composeState(
              {
                userId: this.runtime.agentId,
                roomId: stringToUuid4(
                  tweet.conversationId + "-" + this.runtime.agentId
                ),
                agentId: this.runtime.agentId,
                content: {
                  text: tweet.text,
                  action: "QUOTE"
                }
              },
              {
                twitterUserName: this.client.profile.username,
                currentPost: `From @${tweet.username}: ${tweet.text}`,
                formattedConversation,
                imageContext: imageDescriptions.length > 0 ? `
Images in Tweet:
${imageDescriptions.map(
                  (desc, i) => `Image ${i + 1}: ${desc}`
                ).join("\n")}` : "",
                quotedContent
              }
            );
            const quoteContent = await this.generateTweetContent(
              enrichedState,
              {
                template: ((_b = this.runtime.character.templates) == null ? void 0 : _b.twitterMessageHandlerTemplate) || twitterMessageHandlerTemplate
              }
            );
            if (!quoteContent) {
              elizaLogger4.error(
                "Failed to generate valid quote tweet content"
              );
              return;
            }
            elizaLogger4.log(
              "Generated quote tweet content:",
              quoteContent
            );
            if (this.isDryRun) {
              elizaLogger4.info(
                `Dry run: A quote tweet for tweet ID ${tweet.id} would have been posted with the following content: "${quoteContent}".`
              );
              executedActions.push("quote (dry run)");
            } else {
              const result = await this.client.requestQueue.add(
                async () => await this.client.twitterClient.sendQuoteTweet(
                  quoteContent,
                  tweet.id
                )
              );
              const body = await result.json();
              if ((_e = (_d = (_c = body == null ? void 0 : body.data) == null ? void 0 : _c.create_tweet) == null ? void 0 : _d.tweet_results) == null ? void 0 : _e.result) {
                elizaLogger4.log(
                  "Successfully posted quote tweet"
                );
                executedActions.push("quote");
                await this.runtime.cacheManager.set(
                  `twitter/quote_generation_${tweet.id}.txt`,
                  `Context:
${enrichedState}

Generated Quote:
${quoteContent}`
                );
              } else {
                elizaLogger4.error(
                  "Quote tweet creation failed:",
                  body
                );
              }
            }
          } catch (error) {
            elizaLogger4.error(
              "Error in quote tweet generation:",
              error
            );
          }
        }
        if (actionResponse.reply) {
          try {
            await this.handleTextOnlyReply(
              tweet,
              tweetState,
              executedActions
            );
          } catch (error) {
            elizaLogger4.error(
              `Error replying to tweet ${tweet.id}:`,
              error
            );
          }
        }
        await this.runtime.ensureRoomExists(roomId);
        await this.runtime.ensureUserExists(
          stringToUuid4(tweet.userId),
          tweet.username,
          tweet.name,
          "twitter"
        );
        await this.runtime.ensureParticipantInRoom(
          this.runtime.agentId,
          roomId
        );
        if (!this.isDryRun) {
          await this.runtime.messageManager.createMemory({
            id: stringToUuid4(tweet.id + "-" + this.runtime.agentId),
            userId: stringToUuid4(tweet.userId),
            content: {
              text: tweet.text,
              url: tweet.permanentUrl,
              source: "twitter",
              action: executedActions.join(",")
            },
            agentId: this.runtime.agentId,
            roomId,
            embedding: getEmbeddingZeroVector4(),
            createdAt: tweet.timestamp * 1e3
          });
        }
        results.push({
          tweetId: tweet.id,
          actionResponse,
          executedActions
        });
      } catch (error) {
        elizaLogger4.error(`Error processing tweet ${tweet.id}:`, error);
        continue;
      }
    }
    return results;
  }
  /**
   * Handles text-only replies to tweets. If isDryRun is true, only logs what would
   * have been replied without making API calls.
   */
  async handleTextOnlyReply(tweet, tweetState, executedActions) {
    var _a, _b;
    try {
      const thread = await buildConversationThread(tweet, this.client);
      const formattedConversation = thread.map(
        (t) => `@${t.username} (${new Date(
          t.timestamp * 1e3
        ).toLocaleString()}): ${t.text}`
      ).join("\n\n");
      const imageDescriptions = [];
      if (((_a = tweet.photos) == null ? void 0 : _a.length) > 0) {
        elizaLogger4.log("Processing images in tweet for context");
        for (const photo of tweet.photos) {
          const description = await this.runtime.getService(
            ServiceType2.IMAGE_DESCRIPTION
          ).describeImage(photo.url);
          imageDescriptions.push(description);
        }
      }
      let quotedContent = "";
      if (tweet.quotedStatusId) {
        try {
          const quotedTweet = await this.client.twitterClient.getTweet(
            tweet.quotedStatusId
          );
          if (quotedTweet) {
            quotedContent = `
Quoted Tweet from @${quotedTweet.username}:
${quotedTweet.text}`;
          }
        } catch (error) {
          elizaLogger4.error("Error fetching quoted tweet:", error);
        }
      }
      const enrichedState = await this.runtime.composeState(
        {
          userId: this.runtime.agentId,
          roomId: stringToUuid4(
            tweet.conversationId + "-" + this.runtime.agentId
          ),
          agentId: this.runtime.agentId,
          content: { text: tweet.text, action: "" }
        },
        {
          twitterUserName: this.client.profile.username,
          currentPost: `From @${tweet.username}: ${tweet.text}`,
          formattedConversation,
          imageContext: imageDescriptions.length > 0 ? `
Images in Tweet:
${imageDescriptions.map((desc, i) => `Image ${i + 1}: ${desc}`).join("\n")}` : "",
          quotedContent
        }
      );
      const replyText = await this.generateTweetContent(enrichedState, {
        template: ((_b = this.runtime.character.templates) == null ? void 0 : _b.twitterMessageHandlerTemplate) || twitterMessageHandlerTemplate
      });
      if (!replyText) {
        elizaLogger4.error("Failed to generate valid reply content");
        return;
      }
      if (this.isDryRun) {
        elizaLogger4.info(
          `Dry run: reply to tweet ${tweet.id} would have been: ${replyText}`
        );
        executedActions.push("reply (dry run)");
        return;
      }
      elizaLogger4.debug("Final reply text to be sent:", replyText);
      let result;
      if (replyText.length > DEFAULT_MAX_TWEET_LENGTH) {
        result = await this.handleNoteTweet(
          this.client,
          replyText,
          tweet.id
        );
      } else {
        result = await this.sendStandardTweet(
          this.client,
          replyText,
          tweet.id
        );
      }
      if (result) {
        elizaLogger4.log("Successfully posted reply tweet");
        executedActions.push("reply");
        await this.runtime.cacheManager.set(
          `twitter/reply_generation_${tweet.id}.txt`,
          `Context:
${enrichedState}

Generated Reply:
${replyText}`
        );
      } else {
        elizaLogger4.error("Tweet reply creation failed");
      }
    } catch (error) {
      elizaLogger4.error("Error in handleTextOnlyReply:", error);
    }
  }
  async stop() {
    this.stopProcessingActions = true;
  }
  // private async sendForApproval(
  //     tweetTextForPosting: string,
  //     roomId: UUID,
  //     rawTweetContent: string
  // ): Promise<string | null> {
  //     try {
  //         const embed = {
  //             title: "New Tweet Pending Approval",
  //             description: tweetTextForPosting,
  //             fields: [
  //                 {
  //                     name: "Character",
  //                     value: this.client.profile.username,
  //                     inline: true,
  //                 },
  //                 {
  //                     name: "Length",
  //                     value: tweetTextForPosting.length.toString(),
  //                     inline: true,
  //                 },
  //             ],
  //             footer: {
  //                 text: "Reply with '👍' to post or '❌' to discard, This will automatically expire and remove after 24 hours if no response received",
  //             },
  //             timestamp: new Date().toISOString(),
  //         };
  //         const channel = await this.discordClientForApproval.channels.fetch(
  //             this.discordApprovalChannelId
  //         );
  //         if (!channel || !(channel instanceof TextChannel)) {
  //             throw new Error("Invalid approval channel");
  //         }
  //         const message = await channel.send({ embeds: [embed] });
  //         // Store the pending tweet
  //         const pendingTweetsKey = `twitter/${this.client.profile.username}/pendingTweet`;
  //         const currentPendingTweets =
  //             (await this.runtime.cacheManager.get<PendingTweet[]>(
  //                 pendingTweetsKey
  //             )) || [];
  //         // Add new pending tweet
  //         currentPendingTweets.push({
  //             tweetTextForPosting,
  //             roomId,
  //             rawTweetContent,
  //             discordMessageId: message.id,
  //             channelId: this.discordApprovalChannelId,
  //             timestamp: Date.now(),
  //         });
  //         // Store updated array
  //         await this.runtime.cacheManager.set(
  //             pendingTweetsKey,
  //             currentPendingTweets
  //         );
  //         return message.id;
  //     } catch (error) {
  //         elizaLogger.error(
  //             "Error Sending Twitter Post Approval Request:",
  //             error
  //         );
  //         return null;
  //     }
  // }
  // private async checkApprovalStatus(
  //     discordMessageId: string
  // ): Promise<PendingTweetApprovalStatus> {
  //     try {
  //         // Fetch message and its replies from Discord
  //         const channel = await this.discordClientForApproval.channels.fetch(
  //             this.discordApprovalChannelId
  //         );
  //         elizaLogger.log(`channel ${JSON.stringify(channel)}`);
  //         if (!(channel instanceof TextChannel)) {
  //             elizaLogger.error("Invalid approval channel");
  //             return "PENDING";
  //         }
  //         // Fetch the original message and its replies
  //         const message = await channel.messages.fetch(discordMessageId);
  //         // Look for thumbs up reaction ('👍')
  //         const thumbsUpReaction = message.reactions.cache.find(
  //             (reaction) => reaction.emoji.name === "👍"
  //         );
  //         // Look for reject reaction ('❌')
  //         const rejectReaction = message.reactions.cache.find(
  //             (reaction) => reaction.emoji.name === "❌"
  //         );
  //         // Check if the reaction exists and has reactions
  //         if (rejectReaction) {
  //             const count = rejectReaction.count;
  //             if (count > 0) {
  //                 return "REJECTED";
  //             }
  //         }
  //         // Check if the reaction exists and has reactions
  //         if (thumbsUpReaction) {
  //             // You might want to check for specific users who can approve
  //             // For now, we'll return true if anyone used thumbs up
  //             const count = thumbsUpReaction.count;
  //             if (count > 0) {
  //                 return "APPROVED";
  //             }
  //         }
  //         return "PENDING";
  //     } catch (error) {
  //         elizaLogger.error("Error checking approval status:", error);
  //         return "PENDING";
  //     }
  // }
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
        return;
      }
      elizaLogger4.log("Checking approval status...");
    }
  }
};

// src/client.ts
var TwitterManager = class {
  client;
  post;
  // search: TwitterSearchClient;
  // interaction: TwitterInteractionClient;
  // space?: TwitterSpaceClient;
  constructor(runtime, twitterConfig) {
    this.client = new ClientBase(runtime, twitterConfig);
    this.post = new TwitterPostClient(this.client, runtime);
    if (twitterConfig.TWITTER_SEARCH_ENABLE) {
      elizaLogger5.warn("Twitter/X client running in a mode that:");
      elizaLogger5.warn("1. violates consent of random users");
      elizaLogger5.warn("2. burns your rate limit");
      elizaLogger5.warn("3. can get your account banned");
      elizaLogger5.warn("use at your own risk");
    }
    if (twitterConfig.TWITTER_SPACES_ENABLE) {
    }
  }
  async stop() {
    elizaLogger5.warn("Twitter client does not support stopping yet");
  }
};
var TwitterClientInterface = {
  name: "twitter",
  description: "Twitter client",
  async start(runtime) {
    const twitterConfig = await validateTwitterConfig(runtime);
    elizaLogger5.log("Twitter client started");
    const manager = new TwitterManager(runtime, twitterConfig);
    elizaLogger5.info("Calling manager.client.init()");
    await manager.client.init();
    elizaLogger5.info("manager.client.init() completed");
    await manager.post.start();
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