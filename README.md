# Discord Video Sharer

This project is for sharing embedded videos to discord via a webhook, rather than sharing a link to an external website.

This uses 'yt-dlp' to download videos.
Within server.js is a whitelist for tested platforms that work with yt-dlp. This can be expanded in future.

### Expected .env file
```bash
PORT= # Port number for web service to run on
MAX_FILE_SIZE= # Unless your server is boosted, this will be 10
MAX_VIDEO_LENGTH= # Size in seconds (we recommend 150. longer lengths may not work properly when trying to be compresssed)
SERVER_NAME= # Name of your discord server
CHANNELS= # Expected in single-line JSON format. e.g. [{"name":"NameOfYourChannel","webhook":"YourWebhookURL"},{"name":"NameOfDifferentChannel","webhook":"YourOtherChannelsWebhook"}]
DEFAULT_CHANNEL= # The name of the default channel for it to choose
```