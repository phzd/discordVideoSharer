# Discord Video Sharer

This project is for sharing embedded videos to discord via a webhook, rather than sharing a link to an external website.

This uses 'yt-dlp' to download videos.
Within server.js is a whitelist for tested platforms that work with yt-dlp. This can be expanded in future.


## Installation

Download the repository and use npm to install all of the dependencies

```bash
npm install discordVideoSharer
cd discordVideoSharer
```

Rename the '.envExample' file to '.env' and update the parameters within to match your discord server and webhooks.

Use pm2 to run the web server.
```bash
pm2 start server.js --name discordVideoSharer
```
    