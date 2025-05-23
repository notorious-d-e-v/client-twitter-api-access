import {
    parseBooleanFromText,
    type IAgentRuntime,
    ActionTimelineType,
} from "@elizaos/core";
import { z, ZodError } from "zod";

export const DEFAULT_MAX_TWEET_LENGTH = 280;

const twitterUsernameSchema = z
    .string()
    .min(1, "An X/Twitter Username must be at least 1 character long")
    .max(15, "An X/Twitter Username cannot exceed 15 characters")
    .refine((username) => {
        // Allow wildcard '*' as a special case
        if (username === "*") return true;

        // Twitter usernames can:
        // - Start with digits now
        // - Contain letters, numbers, underscores
        // - Must not be empty
        return /^[A-Za-z0-9_]+$/.test(username);
    }, "An X Username can only contain letters, numbers, and underscores");

/**
 * This schema defines all required/optional environment settings,
 * including new fields like TWITTER_SPACES_ENABLE.
 */
export const twitterEnvSchema = z.object({
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
    TWITTER_MENTIONS_LIMIT: z.number().int().default(10),
    TWITTER_INTERACTIONS_CATCHUP: z.boolean().default(false),
    ENABLE_TWITTER_POST_GENERATION: z.boolean().default(true),
    POST_INTERVAL_MIN: z.number().int(),
    POST_INTERVAL_MAX: z.number().int(),
    ENABLE_ACTION_PROCESSING: z.boolean().default(false),
    ACTION_INTERVAL: z.number().int(),
    POST_IMMEDIATELY: z.boolean().default(false),
    TWITTER_SPACES_ENABLE: z.boolean().default(false),
    MAX_ACTIONS_PROCESSING: z.number().int(),
    ACTION_TIMELINE_TYPE: z
        .nativeEnum(ActionTimelineType)
        .default(ActionTimelineType.ForYou),
});

export type TwitterConfig = z.infer<typeof twitterEnvSchema>;

/**
 * Helper to parse a comma-separated list of Twitter usernames
 * (already present in your code).
 */
function parseTargetUsers(targetUsersStr?: string | null): string[] {
    if (!targetUsersStr?.trim()) {
        return [];
    }
    return targetUsersStr
        .split(",")
        .map((user) => user.trim())
        .filter(Boolean);
}

function safeParseInt(
    value: string | undefined | null,
    defaultValue: number
): number {
    if (!value) return defaultValue;
    const parsed = Number.parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : Math.max(1, parsed);
}

/**
 * Validates or constructs a TwitterConfig object using zod,
 * taking values from the IAgentRuntime or process.env as needed.
 */
// This also is organized to serve as a point of documentation for the client
// most of the inputs from the framework (env/character)

// we also do a lot of typing/parsing here
// so we can do it once and only once per character
export async function validateTwitterConfig(
    runtime: IAgentRuntime
): Promise<TwitterConfig> {
    try {
        const twitterConfig = {
            TWITTER_DRY_RUN:
                parseBooleanFromText(
                    runtime.getSetting("TWITTER_DRY_RUN") ||
                        process.env.TWITTER_DRY_RUN
                ) ?? false, // parseBooleanFromText return null if "", map "" to false

            TWITTER_APP_KEY: 
                runtime.getSetting("TWITTER_APP_KEY") ||
                process.env.TWITTER_APP_KEY,

            TWITTER_APP_SECRET:
                runtime.getSetting("TWITTER_APP_SECRET") ||
                process.env.TWITTER_APP_SECRET,

            TWITTER_ACCESS_TOKEN:
                runtime.getSetting("TWITTER_ACCESS_TOKEN") ||
                process.env.TWITTER_ACCESS_TOKEN,
            
            TWITTER_ACCESS_SECRET:
                runtime.getSetting("TWITTER_ACCESS_SECRET") ||
                process.env.TWITTER_ACCESS_SECRET,

            // number as string?
            MAX_TWEET_LENGTH: safeParseInt(
                runtime.getSetting("MAX_TWEET_LENGTH") ||
                    process.env.MAX_TWEET_LENGTH,
                DEFAULT_MAX_TWEET_LENGTH
            ),

            TWITTER_MENTIONS_LIMIT: safeParseInt(
                runtime.getSetting("TWITTER_MENTIONS_LIMIT") ||
                    process.env.TWITTER_MENTIONS_LIMIT,
                10
            ),

            TWITTER_INTERACTIONS_CATCHUP:
                parseBooleanFromText(
                    runtime.getSetting("TWITTER_INTERACTIONS_CATCHUP") ||
                        process.env.TWITTER_INTERACTIONS_CATCHUP
                ) ?? false,

            TWITTER_SEARCH_ENABLE:
                parseBooleanFromText(
                    runtime.getSetting("TWITTER_SEARCH_ENABLE") ||
                        process.env.TWITTER_SEARCH_ENABLE
                ) ?? false,

            // string passthru
            TWITTER_2FA_SECRET:
                runtime.getSetting("TWITTER_2FA_SECRET") ||
                process.env.TWITTER_2FA_SECRET ||
                "",

            // int
            TWITTER_RETRY_LIMIT: safeParseInt(
                runtime.getSetting("TWITTER_RETRY_LIMIT") ||
                    process.env.TWITTER_RETRY_LIMIT,
                5
            ),

            // int in seconds
            TWITTER_POLL_INTERVAL: safeParseInt(
                runtime.getSetting("TWITTER_POLL_INTERVAL") ||
                    process.env.TWITTER_POLL_INTERVAL,
                120 // 2m
            ),

            // comma separated string
            TWITTER_TARGET_USERS: parseTargetUsers(
                runtime.getSetting("TWITTER_TARGET_USERS") ||
                    process.env.TWITTER_TARGET_USERS
            ),

            // bool
            ENABLE_TWITTER_POST_GENERATION:
                parseBooleanFromText(
                    runtime.getSetting("ENABLE_TWITTER_POST_GENERATION") ||
                        process.env.ENABLE_TWITTER_POST_GENERATION
                ) ?? true,


            // int in minutes
            POST_INTERVAL_MIN: safeParseInt(
                runtime.getSetting("POST_INTERVAL_MIN") ||
                    process.env.POST_INTERVAL_MIN,
                90 // 1.5 hours
            ),

            // int in minutes
            POST_INTERVAL_MAX: safeParseInt(
                runtime.getSetting("POST_INTERVAL_MAX") ||
                    process.env.POST_INTERVAL_MAX,
                180 // 3 hours
            ),

            // bool
            ENABLE_ACTION_PROCESSING:
                parseBooleanFromText(
                    runtime.getSetting("ENABLE_ACTION_PROCESSING") ||
                        process.env.ENABLE_ACTION_PROCESSING
                ) ?? false,

            // init in minutes (min 1m)
            ACTION_INTERVAL: safeParseInt(
                runtime.getSetting("ACTION_INTERVAL") ||
                    process.env.ACTION_INTERVAL,
                5 // 5 minutes
            ),

            // bool
            POST_IMMEDIATELY:
                parseBooleanFromText(
                    runtime.getSetting("POST_IMMEDIATELY") ||
                        process.env.POST_IMMEDIATELY
                ) ?? false,

            TWITTER_SPACES_ENABLE:
                parseBooleanFromText(
                    runtime.getSetting("TWITTER_SPACES_ENABLE") ||
                        process.env.TWITTER_SPACES_ENABLE
                ) ?? false,

            MAX_ACTIONS_PROCESSING: safeParseInt(
                runtime.getSetting("MAX_ACTIONS_PROCESSING") ||
                    process.env.MAX_ACTIONS_PROCESSING,
                1
            ),

            ACTION_TIMELINE_TYPE:
                runtime.getSetting("ACTION_TIMELINE_TYPE") ||
                process.env.ACTION_TIMELINE_TYPE,
        };

        return twitterEnvSchema.parse(twitterConfig);
    } catch (error) {
        if (error instanceof ZodError) {
            const errorMessages = error.errors
                .map((err) => `${err.path.join(".")}: ${err.message}`)
                .join("\n");
            throw new Error(
                `X/Twitter configuration validation failed:\n${errorMessages}`
            );
        }
        throw error;
    }
}
