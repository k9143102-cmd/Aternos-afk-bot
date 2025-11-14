// This script requires the 'node-fetch' and 'dotenv' packages.
const fetch = require('node-fetch');
const dotenv = require('dotenv');

dotenv.config({ path: 'config.env' });

const ATERNOS_USERNAME = process.env.ATERNOS_USERNAME;
const ATERNOS_PASSWORD = process.env.ATERNOS_PASSWORD;

if (!ATERNOS_USERNAME || !ATERNOS_PASSWORD) {
    console.error('ERROR: ATERNOS_USERNAME or ATERNOS_PASSWORD is not set in config.env. Cannot start server.');
    process.exit(1);
}

const LOGIN_URL = 'https://aternos.org/panel/ajax/login.php';
const SERVER_LIST_URL = 'https://aternos.org/panel/ajax/getservers.php';
const SERVER_START_URL = 'https://aternos.org/panel/ajax/start.php';

let cookies = '';
let aternosToken = '';
let serverId = '';

/**
 * Executes a network request to log into Aternos and obtain session cookies and token.
 */
async function loginAndGetToken() {
    console.log('[Aternos API] Attempting login...');
    
    const response = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'GuardianBot/1.0',
        },
        body: `user=${encodeURIComponent(ATERNOS_USERNAME)}&password=${encodeURIComponent(ATERNOS_PASSWORD)}&remember=true`
    });

    const responseText = await response.text();
    const data = JSON.parse(responseText);

    if (data.success !== true) {
        throw new Error(`Login failed: ${data.err}`);
    }

    // Extract cookies from the response headers
    const setCookieHeader = response.headers.get('set-cookie');
    if (!setCookieHeader) {
        throw new Error('Login successful but missing required session cookies.');
    }
    
    // Simple cookie parsing to get the required session values (xfg, ATsid)
    cookies = setCookieHeader.split(',')
        .map(cookie => cookie.trim().split(';')[0])
        .join('; ');
    
    // The Aternos token is now usually available as a cookie called 'ATtoken'
    const tokenMatch = setCookieHeader.match(/ATtoken=([^;]+)/);
    if (tokenMatch) {
        aternosToken = tokenMatch[1];
        cookies += `; ATtoken=${aternosToken}`;
    } else {
        // Fallback: Sometimes the token is on the server list page, but we skip that complex step
        // We will proceed without it and hope the server starts with just the session cookies.
        console.warn('[Aternos API] Warning: Could not find ATtoken cookie. Proceeding with session cookies.');
    }
    
    console.log('[Aternos API] Login successful. Session cookies obtained.');
}

/**
 * Finds the server ID (PID) required for the start command.
 */
async function findServerId() {
    console.log('[Aternos API] Fetching server list to find ID...');

    const response = await fetch(SERVER_LIST_URL, {
        headers: {
            'Cookie': cookies,
            'User-Agent': 'GuardianBot/1.0',
        }
    });

    const responseText = await response.text();
    const data = JSON.parse(responseText);

    if (!data.servers || data.servers.length === 0) {
        throw new Error('Could not find any servers in the account.');
    }
    
    // Assuming the bot is intended for the main server associated with the account
    // Aternos usually returns the primary server first.
    const server = data.servers[0]; 
    serverId = server.id;
    
    console.log(`[Aternos API] Found server ID (PID): ${serverId}`);
}

/**
 * Sends the request to start the server.
 */
async function startServer() {
    console.log('[Aternos API] Sending START command...');
    
    const body = new URLSearchParams();
    body.append('id', serverId);
    
    // Required headers for the API request
    const headers = {
        'Cookie': cookies,
        'User-Agent': 'GuardianBot/1.0',
        'Referer': 'https://aternos.org/server/',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
    };
    
    // If we managed to get a token, add it to the headers (required for newer Aternos security)
    if (aternosToken) {
        headers['ATtoken'] = aternosToken;
    }

    const response = await fetch(SERVER_START_URL, {
        method: 'POST',
        headers: headers,
        body: body,
    });

    const responseText = await response.text();
    let data;
    try {
        data = JSON.parse(responseText);
    } catch (e) {
        // Sometimes the response is a raw HTML error page if the API call fails unexpectedly
        console.error('[Aternos API] Failed to parse JSON response. Server might be under heavy load.');
        throw new Error(`Non-JSON response received: ${responseText.substring(0, 100)}...`);
    }

    if (data.status === 'success' || data.success === true) {
        console.log('[Aternos API] Server start command SUCCESS!');
        if (data.queue) {
            console.log(`[Aternos API] Server is now in the queue. Waiting time: ${data.queue} seconds.`);
        }
        return data;
    } else if (data.status === 'queue') {
        console.log(`[Aternos API] Server is now in the queue. Waiting time: ${data.queue} seconds.`);
        return data;
    } else if (data.status === 'starting') {
        console.log('[Aternos API] Server is already starting.');
        return data;
    } else {
        throw new Error(`Server start failed: ${data.message || JSON.stringify(data)}`);
    }
}


/**
 * Main execution function for the server starter.
 */
async function startAternosServer() {
    try {
        await loginAndGetToken();
        await findServerId();
        const startResponse = await startServer();
        
        // If the server goes into a queue, we will return the expected wait time (if available)
        const waitTime = startResponse.queue || 90; // Default to 90 seconds if queue time isn't specified

        console.log(`[Aternos API] Process complete. Wait time before retry: ${waitTime} seconds.`);
        // Write the wait time to stdout so the parent script can read it
        console.log(`WAIT_TIME_SECONDS:${waitTime}`); 

    } catch (error) {
        console.error(`\n❌ [Aternos API Error] Could not start Aternos server: ${error.message}`);
    } finally {
        process.exit(); 
    }
}

startAternosServer();
