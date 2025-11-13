const express = require('express'); // Module for hosting an express server
const path = require("path") // Module for managing and joining paths/directories
const { exec, execFile } = require("child_process") // Module for executing processes on the system
const { randomUUID } = require('crypto'); // Module used for creating random UUIDs
const fs = require("fs"); // Module for managing files
const promisefs = require("fs").promises // Module for managing files with promises
const axios = require("axios") // Module for making webhook request
const formData = require("form-data") // Module for putting together message headers
const url = require('url'); // Module for URL handling
const cookieParser = require('cookie-parser') // Module for handling cookies
const { error } = require('console');

require('dotenv').config() // Module for importing .env variables

// Create an Express application instance
const app = express();

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// Use EJS view engine
app.set('view engine', 'ejs')

// Definitions
const PORT = process.env.PORT
const MAX_FILE_SIZE = process.env.MAX_FILE_SIZE
const MAX_VIDEO_LENGTH = process.env.MAX_VIDEO_LENGTH
const SERVER_NAME = process.env.SERVER_NAME
const CHANNELS = JSON.parse(process.env.CHANNELS)
const DEFAULT_CHANNEL = process.env.DEFAULT_CHANNEL

const supportedDomains = [
    "www.youtube.com",
    "youtube.com",
    "youtu.be",
    "www.youtu.be",
    "instagram.com",
    "www.instagram.com",
    "www.twitch.tv",
    "twitch.tv",
    "reddit.com",
    "www.reddit.com",
    "facebook.com",
    "www.facebook.com",
    "x.com",
    "twitter.com",
    "www.x.com",
    "wwww.twitter.com",
    "tiktok.com",
    "www.tiktok.com",
    "vt.tiktok.com"
]

const logFile = path.join(__dirname, 'logs', 'app.log');

// Uses yt-dlp to download video
function downloadVideo(url, output) {
    return new Promise((resolve, reject) => {
        execFile('yt-dlp',  [
            '-o', `cache/downloads/${output}.mp4`,
            '--recode-video', 'mp4',
            url
        ], (error, stdout, stderr) => {
            //log(stdout)
            if (error) return reject(error);
            if (stderr) log(`Error: ${stderr}`);
            resolve(stdout);
        });
    });
}

// Uses ffmpeg to shrink video to atleast 10MB
async function shrinkVideo(video) {
    const filePath = `cache/downloads/${video}`
    const outputFilePath = `cache/videos/${video}`
    const safeFileSize = MAX_FILE_SIZE * 0.9

    // Get file stats
    const stats = fs.statSync(filePath);
    const fileSizeInMB = stats.size / (1024 * 1024);
    log(`${video} is ${fileSizeInMB.toPrecision(2)}MB`)

    if (fileSizeInMB > safeFileSize) {
        log(`${video} is greater than ${MAX_FILE_SIZE}MB, resizing...`);
        // Get duration with ffprobe
        const duration = await new Promise((resolve, reject) => {
            execFile('ffprobe',  [
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                filePath
            ], 
                (err, stdout) => {
                    if (err) return reject(err);
                    resolve(parseFloat(stdout));
                }
            );
        });

        if (!duration || duration <= 0) throw new Error("Could not get video duration");

        // Calculate target bitrate
        const targetBits = safeFileSize * 8_000_000;
        const totalBitrate = Math.floor(targetBits / duration); // bits per second
        const audioBitrate = 64_000; // 64 kbps audio
        const videoBitrate = totalBitrate - audioBitrate;

        if (videoBitrate <= 0) throw new Error("Target size too small for given duration");

        log(`${video} duration is: ${duration}s`);
        log(`${video} target bitrate: ${Math.floor(videoBitrate / 1000)} kbps`);

        // Run ffmpeg with calculated bitrate
        return new Promise((resolve, reject) => {
            execFile(
                'ffmpeg',  [
                    '-i', filePath,
                    '-c:v', 'libx264',
                    '-b:v', videoBitrate.toString(),
                    '-c:a', 'aac',
                    '-b:a', audioBitrate.toString(),
                    outputFilePath,
                    '-y'
                ],
                (err, stdout, stderr) => {
                    //log(stdout)
                    if (err) return reject(err);
                    resolve(outputFilePath);
                }
            );
        });

    } else {
        // File size is already under 10MB, move it to videos folder
        fs.rename(filePath, outputFilePath, (err) => {
        if (err) throw err;
        //log('Moved video to videos folder, ready to send!');
        });
        return
    }
}

// Uses discord webhook to send video to discord
async function sendVideo(video, message, username, channel) {
    const form = new formData();
    const filePath = `cache/videos/${video}`
    let webhookMessage = ""

    // Add message text if applicable
    if (username) {
        webhookMessage += `${username} shared:`
    }
    if (message) {
        webhookMessage += `\n${message}`
    }

    form.append("content", webhookMessage)

    // Add the video file
    form.append("file", fs.createReadStream(filePath));

    const selectedChannel = CHANNELS.find(c => c.name === channel)

    if (!selectedChannel) {
        throw new error("No channel matches from specified list")
    }

    try {
        const res = await axios.post(selectedChannel.webhook, form, {
            headers: form.getHeaders(),
        });
        log(`Message sent: ${res.status}`);
    } catch (err) {
        log(`Error sending webhook: ${err.response?.data || err.message}`);
    }
}

// Checks the length of a video
function checkVideoLength(url) {
    return new Promise((resolve, reject) => {
        execFile('yt-dlp', [
            '--get-duration',
            url
        ], (error, stdout, stderr) => {
            if (error) return reject(error);
            if (stderr) log(`Error: ${stderr}`);

            const durationStr = stdout.trim();
            const parts = durationStr.split(":").map(Number);
            let seconds = 0;
            if (parts.length === 3) {
                seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
            } else if (parts.length === 2) {
                seconds = parts[0] * 60 + parts[1];
            } else {
                seconds = parts[0];
            }

            log(`Video length is: ${durationStr}`)
            resolve(seconds);
        });
    });
}

// Check to see if url is using an approved domain
function isApprovedUrl(url, approvedDomains) {
    try {
        const parsedUrl = new URL(url);
        return approvedDomains.includes(parsedUrl.hostname.toLowerCase());
    } catch (err) {
        return false; // invalid URL
    }
}

// Logs data to file
function log(message, ip = null) {
  const timestamp = new Date().toISOString();
  const ipStr = ip ? ` [IP: ${ip}]` : '';
  const logEntry = `[${timestamp}]${ipStr} ${message}\n`;
  
  // Write to file
  fs.appendFileSync(logFile, logEntry);
  
  // Also print to console
  console.log(logEntry.trim());
}

// Cleans up files in case of failure
async function cleanupFiles(guid, folder = "cache") {
    log(`Cleaning up files within ${folder}`)
    try {
        const items = await promisefs.readdir(folder)

        for (const item of items) {
        const fullPath = path.join(folder, item);
            try {
                // Get item stats to determine if it's a file or directory
                const stats = await promisefs.stat(fullPath);
                
                if (item.startsWith(guid)) {
                    await promisefs.unlink(fullPath);
                    //log(`Deleted file: ${fullPath}`);
                } else if (stats.isDirectory()) {
                    // Recursively check subdirectories
                    await cleanupFiles(guid, fullPath);
                }
            } catch (itemError) {
                log(`Error processing ${fullPath}: ${itemError.message}`);
            }
        }
    } catch (err) {
        log(`Error while cleaning ${folder}: ${err.message}`);
    }
}

// Get video title
function getVideoTitle(url) {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', [
        '--get-title',
        url
    ], (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(stderr || error.message));
      }
      resolve(stdout.trim());
    });
  });
}

// Complete full download and send of video
async function downloadAndSend(url, guid, res, message, req, channel) {
    // Check video length
    log(`Requested to download: ${url}`, req.ip)
    const videoLength = await checkVideoLength(url)
    if (videoLength > MAX_VIDEO_LENGTH) {
        const errorMessage = `Video is longer than ${MAX_VIDEO_LENGTH} seconds`
        res.render('error.ejs', { errorMessage: errorMessage})
        log(errorMessage)
        throw new error(errorMessage)
    }
    // Get video title
    const videoTitle = await getVideoTitle(url)
    if (videoTitle) {
        res.render('success.ejs', {videoTitle: videoTitle})
    }
    // Attempt to download the video
    await downloadVideo(url, guid)
    log(`Video Downloaded as: ${guid}.mp4`)
    // Reduce file size to MB (If applicable)
    await shrinkVideo(`${guid}.mp4`)
    // Send the video to discord via webhook
    const username = req.cookies.username
    sendVideo(`${guid}.mp4`, message, username, channel)
}

// Save username to cookie
app.post("/set-username", (req, res) => {
    const { username } = req.body;
    if (username) {
        res.cookie("username", username, { maxAge: 10 * 365 * 24 * 60 * 60 * 1000 }); // 10 years
        log(`set username to: ${username}`, req.ip)
    } else {
        res.clearCookie("username")
        log(`cleared username`, req.ip)
    }
    res.redirect("/");
});

// Serve static files from "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to check all incoming requests
app.use(async (req, res, next) => {
    // Get the full URL after the domain
    const fullPath = req.url.substring(1); // Remove leading slash
    
    // Find the last occurrence of /? to split the embedded URL from your message param
    const lastSlashQuestion = fullPath.lastIndexOf('/?');
    
    let videoUrl, message = '';
    let channel = DEFAULT_CHANNEL
    
    if (lastSlashQuestion !== -1) {
        // Split at the last /?
        videoUrl = fullPath.substring(0, lastSlashQuestion);
        const queryPart = fullPath.substring(lastSlashQuestion + 2); // +2 to skip "/?""
        
        // Parse the query parameters
        const params = new URLSearchParams(queryPart);
        message = params.get('message') || '';
        channel = params.get('channel') || DEFAULT_CHANNEL
    } else {
        // No message parameter, treat entire thing as video URL
        videoUrl = fullPath;
    }
    
    const guid = randomUUID();

    // Expected format: http://localhost:3000/https://www.youtube.com/watch?v=tCDvOQI3pco/?message=hello%20how%20are%20you

    // Checks to see if there is a path and it's not just root
    if (videoUrl) {
        if (isApprovedUrl(videoUrl, supportedDomains)) {
            try {
                await downloadAndSend(videoUrl, guid, res, message, req, channel) 
                cleanupFiles(guid)     
            } catch (err) {
                log(`Failed to download ${videoUrl}`, err)
                cleanupFiles(guid)
            }
        } else {
            res.render('error.ejs', {errorMessage: `URL below is not an approved URL.`, errorSource: videoUrl})
            log(`URL '${fullPath}' is not an approved URL`)
        }
    } else {
        log('Connected to home page', req.ip);
        res.render('index.ejs', {server: SERVER_NAME, username: req.cookies.username || "", channels: CHANNELS, defaultChannel: DEFAULT_CHANNEL})
    }
    
    next();
});

// Start the server and listen on the specified port
app.listen(PORT, () => {
    // log(`Server running on port: ${PORT}`);
});