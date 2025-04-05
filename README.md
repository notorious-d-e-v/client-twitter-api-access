# Eliza Twitter/X Client (V2 API, API Access)

Twitter/X integration for Eliza Agents!

This library uses **X API Access Keys instead of X username and password**.
We consider this to be more reliable, because your account won't get banned.
Additionally, it's not a constant arms race to find new ways to outsmart the X dev team.

Use [@elizaos-plugins/twitter-client](https://github.com/elizaos-plugins/client-twitter) if you are looking to use username and password authentication instead.

This is a work in progress and will be built out as needed.

## Features

- Post generation and management
- Interaction handling (mentions, ~~replies)~~ (needs re-implementing)
- ~~Search functionality~~ (needs re-implementing)
- ~~Twitter Spaces support with STT/TTS capabilities~~ (needs re-implementing)
- ~~Media handling (images, videos)~~ (needs re-implementing)
- Approval workflow via Discord (optional)

## Setup Guide

### Prerequisites

- A Twitter/X Developer Account with API access
- Node.js and pnpm installed
- Discord bot (if using approval workflow)
- ElevenLabs API key (if using Spaces with TTS)

### Step 0: Get Your API Keys

1. Sign into your X account.
2. Go to https://developer.x.com/en/portal/petition/essential/basic-info and sign up for Developer Access. You can choose the Free Tier if you are just starting out.
3. Go to https://developer.x.com/en/portal/projects-and-apps
4. Find the Default Project that X created for you.
5. Look for the App that X created for you and click the Settings gear.
6. Click the "Keys and tokens" tab.
7. Alternatively, go to https://developer.x.com/en/portal/projects/<XXXXXX>/apps/<YYYYYY>/keys where <XXXXX> is your project ID and <YYYYYY> is your app ID.
8. Look for "Consumer Keys" and click Regenerate. **Important** Write these down after you regenerate them.
9. Look for "Authentication Tokens" then look for "Access Token and Secret". Click Regenerate, and make sure you give Read, Write, and DM permissions. **Important** Write down the keys and values.
10. Now you can use your API Key, API Secret, Access Token, and Access Secret to authenticate your user and use the API. We will do this in Step 1 below.   

### Step 1: Install the Plugin

Install the plugin using eliza's command line tool.
From your agent's root directory, do

```bash
npx elizaos plugins list
npx elizaos plugins add @elizaos-plugins/client-twitter-api-access
```

### Step 2: Add the Plugin To Your Character File

Edit your character json file and add `@elizaos-plugins/client-twitter-api-access` to your `plugins`.
Example

```json
{
    ...
    "plugins": [
        ...
        "@elizaos-plugins/client-twitter-api-access"
    ],
    ...
}
```

### Step 3: Configure Environment Variables

Create or edit `.env` file in your project root:

```bash
# Twitter API Credentials
TWITTER_APP_KEY=            # API Key from the previous step
TWITTER_APP_SECRET=         # API Secret from the previous step
TWITTER_ACCESS_TOKEN=       # Access Token from the previous step
TWITTER_ACCESS_SECRET=      # Access Secret from the previous step

# Twitter Client Configuration
TWITTER_DRY_RUN=false      # Set to true for testing without posting
MAX_TWEET_LENGTH=280       # Default tweet length limit
TWITTER_SEARCH_ENABLE=false # Enable search functionality
TWITTER_RETRY_LIMIT=5      # Login retry attempts
TWITTER_POLL_INTERVAL=120  # Poll interval in seconds
TWITTER_TARGET_USERS=      # Comma-separated list of target users

# Post Generation Settings
ENABLE_TWITTER_POST_GENERATION=true
POST_INTERVAL_MIN=90       # Minimum interval between posts (minutes)
POST_INTERVAL_MAX=180      # Maximum interval between posts (minutes)
POST_IMMEDIATELY=false     # Skip approval workflow

# Action Processing
ENABLE_ACTION_PROCESSING=false
ACTION_INTERVAL=5          # Action check interval (minutes)
MAX_ACTIONS_PROCESSING=1   # Maximum concurrent actions

# Spaces Configuration (Optional)
TWITTER_SPACES_ENABLE=false
ELEVENLABS_XI_API_KEY=     # Required for TTS in Spaces

# Approval Workflow (Optional)
TWITTER_APPROVAL_DISCORD_BOT_TOKEN=
TWITTER_APPROVAL_DISCORD_CHANNEL_ID=
TWITTER_APPROVAL_CHECK_INTERVAL=300000  # 5 minutes in milliseconds
```

## Features

### Post Generation

The client can automatically generate and post tweets based on your agent's character profile and topics. Posts can be:
- Regular tweets (≤280 characters)
~~- Long-form tweets (Note Tweets)~~ (needs re-implementing)
~~- Media tweets (with images/videos)~~ (needs re-implementing)

### Interactions

Handles:
- Mentions
- Replies
~~- Quote tweets~~ (need re-implementing)
~~- Direct messages~~ (needs re-implementing)

~~### Search~~ (needs re-implementing)

~~When enabled, periodically searches Twitter for relevant topics and engages with found content.~~

~~### Twitter Spaces~~ (needs re-implementing)

Supports creating and managing Twitter Spaces with:
- Speech-to-Text (STT) for transcription
- Text-to-Speech (TTS) via ElevenLabs
- Speaker management
- Idle monitoring
- Recording capabilities

### Approval Workflow

Optional Discord-based approval system for tweets:
1. Generated tweets are sent to a Discord channel
2. Moderators can approve/reject via reactions
3. Approved tweets are automatically posted

## Development

### Testing

```bash
# Run tests
pnpm test

# Run with debug logging
DEBUG=eliza:* pnpm start
```

### Common Issues

#### Post Generation Issues
- Verify character profile configuration
- Check MAX_TWEET_LENGTH setting
- Monitor approval workflow logs

## Security Notes

- Never commit .env or credential files
- Use environment variables for sensitive data
- Implement proper rate limiting
- Monitor API usage and costs (especially for ElevenLabs)

## Support

For issues or questions:
1. Check the Common Issues section
2. Review debug logs (enable with DEBUG=eliza:*)
3. Open an issue with:
   - Error messages
   - Configuration details
   - Steps to reproduce
