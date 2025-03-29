import { MediaObjectV2,UserV2 } from "twitter-api-v2";

export interface TwitterProfile extends UserV2 {
    bio?: string;
    nicknames?: string[];
};

export type MediaData = {
    data: Buffer;
    mediaType: string;
};

/**
 * A TweetV2 with useful metadata for Eliza usecases.
 */
export interface ElizaTweet {
    id?: string;
    conversationId?: string;
    authorId?: string;
    authorUsername?: string;
    authorName?: string;
    inReplyToStatusId?: string;
    isReply?: boolean;
    isRetweet?: boolean;
    mentions?: UserV2[];
    permanentUrl?: string;
    photos: Photo[];
    text?: string;
    thread: ElizaTweet[];
    timestamp?: number;
    videos: Video[];
  }

  export interface Photo extends MediaObjectV2 {
    type: "photo"
  }

  export interface Video extends MediaObjectV2 {
    type: "video"
  }