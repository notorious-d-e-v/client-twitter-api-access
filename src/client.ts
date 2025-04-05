import { type Client, elizaLogger, type IAgentRuntime, type Plugin } from "@elizaos/core";
import { ClientBase } from "./base.ts";
import { validateTwitterConfig, type TwitterConfig } from "./environment.ts";
import { TwitterInteractionClient } from "./interactions.ts";
import { TwitterPostClient } from "./post.ts";
import { TwitterSearchClient } from "./search.ts";
// import { TwitterSpaceClient } from "./spaces.ts";

/**
 * A manager that orchestrates all specialized Twitter logic:
 * - client: base operations (login, timeline caching, etc.)
 * - post: autonomous posting logic
 * - search: searching tweets / replying logic
 * - interaction: handling mentions, replies
 * - space: launching and managing Twitter Spaces (optional)
 */
class TwitterManager {
    client: ClientBase;
    post: TwitterPostClient;
    // search: TwitterSearchClient;
    interaction: TwitterInteractionClient;
    // space?: TwitterSpaceClient;

    constructor(runtime: IAgentRuntime, twitterConfig: TwitterConfig) {
        // Pass twitterConfig to the base client
        this.client = new ClientBase(runtime, twitterConfig);

        // Posting logic
        this.post = new TwitterPostClient(this.client, runtime);

        // TODO: #TWITTER-V2-001 - Reimplement search logic using Twitter API v2
        // Optional search logic (enabled if TWITTER_SEARCH_ENABLE is true)
        // if (twitterConfig.TWITTER_SEARCH_ENABLE) {
        //     this.search = new TwitterSearchClient(this.client, runtime);
        // }

        // Mentions and interactions
        this.interaction = new TwitterInteractionClient(this.client, runtime);

        // TODO: #TWITTER-V2-002 - Reimplement spaces logic using Twitter API v2
        // Optional Spaces logic (enabled if TWITTER_SPACES_ENABLE is true)
        // if (twitterConfig.TWITTER_SPACES_ENABLE) {
            // this.space = new TwitterSpaceClient(this.client, runtime);
        // }
    }

    async stop() {
        elizaLogger.warn("Twitter client does not support stopping yet");
    }
}

export const TwitterClientInterface: Client = {
    name: 'twitter',
    async start(runtime: IAgentRuntime) {
        const twitterConfig: TwitterConfig =
            await validateTwitterConfig(runtime);

        elizaLogger.log("Twitter client started");

        const manager = new TwitterManager(runtime, twitterConfig);

        // Initialize login/session
        await manager.client.init();

        // Start the posting loop
        await manager.post.start();

        // TODO: #TWITTER-V2-003 - Reimplement search manager initialization using Twitter API v2
        // // Start the search logic if it exists
        // if (manager.search) {
        //     await manager.search.start();
        // }

        // Start interactions (mentions, replies)
        await manager.interaction.start();

        // TODO: #TWITTER-V2-004 - Reimplement spaces manager initialization using Twitter API v2
        // // If Spaces are enabled, start the periodic check
        // if (manager.space) {
        //     manager.space.startPeriodicSpaceCheck();
        // }

        return manager;
    },
};