// --- Render Compatibility: Dummy Web Server Setup ---
// This simple server binds the port (required by Render) so the process doesn't stop.
const http = require('http');
const port = process.env.PORT || 3000;

http.createServer((req, res) => {
    // This server responds to Render's health checks.
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Aternos Bot is running and connected.');
}).listen(port, () => {
    console.log(`[RENDER] Dummy Web Server running on port ${port}.`);
    // NOTE: The bot is NOT running on this server. This is just for Render's process health check.
});
// ----------------------------------------------------


// --- Original Bot Logic Starts Here ---
const mineflayer = require('mineflayer');
// Assume configuration variables are loaded from environment variables (Render Secrets)
const HOST = process.env.HOST;
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;
const VERSION = process.env.VERSION || '1.19.4'; 
const AUTH = process.env.AUTH || 'offline'; // Keep offline mode for Aternos cracked

console.log(`[MINECRAFT] Attempting to connect bot: ${USERNAME}`);

function createBotInstance() {
    // 1. Bot Configuration
    const bot = mineflayer.createBot({
        host: HOST,
        port: 25565, // Standard Minecraft port
        username: USERNAME,
        password: PASSWORD,
        version: VERSION,
        auth: AUTH,
        // The default `connectTimeout` is 10s, but we can be generous
        connectTimeout: 60 * 1000 // 60 seconds
    });

    // 2. Bot Event Handlers
    
    bot.on('login', () => {
        console.log(`[BOT STATUS] Successfully logged in as ${bot.username} on ${HOST}.`);
    });

    bot.on('spawn', () => {
        console.log('[BOT STATUS] Bot spawned into the world. Starting AFK routine...');
        // --- AFK Routine ---
        // A simple way to keep the bot active and prevent disconnection
        setInterval(() => {
            // Randomly look around to simulate activity
            const yaw = Math.random() * Math.PI * 2;
            const pitch = (Math.random() * Math.PI) - (Math.PI / 2);
            bot.look(yaw, pitch, true); 
        }, 10000); // Every 10 seconds

        // Example: Send a message to the server
        setTimeout(() => {
            bot.chat('AFK bot online and running on Render.');
        }, 30000); // 30 seconds after spawning
    });

    bot.on('end', (reason) => {
        console.error(`[BOT ERROR] Bot disconnected. Reason: ${reason}`);
        // If disconnected, try to reconnect after a delay
        if (reason !== 'disconnect.quitting') {
             console.log('[BOT RECONNECT] Attempting to reconnect in 15 seconds...');
             setTimeout(createBotInstance, 15000);
        }
    });

    bot.on('error', (err) => {
        console.error(`[BOT FATAL ERROR] ${err.message}`);
    });

    // Optional: Log chat messages
    bot.on('message', (message) => {
        console.log(`[CHAT] <${message.username}> ${message.toString()}`);
    });
}

// Start the bot sequence
createBotInstance();

// --- Original Bot Logic Ends Here ---
