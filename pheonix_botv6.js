// This script requires:
// 1. mineflayer, mineflayer-pathfinder
// 2. dotenv
// 3. child_process (Built-in Node module)

const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const Goals = goals 
const dotenv = require('dotenv')
const { spawn } = require('child_process'); 

// Load environment variables from config.env file
dotenv.config({ path: 'config.env' })

// --- GLOBAL CONFIGURATION (Read from config.env) ---
const HOST = process.env.HOST 
const PORT = parseInt(process.env.PORT || '25565', 10) 
const VERSION = process.env.VERSION || '1.20.4' 
const MAX_HUMAN_PLAYERS = parseInt(process.env.MAX_HUMAN_PLAYERS || '1', 10) 
const DEFAULT_RECONNECT_WAIT_MS = 60000 // 60 seconds if Aternos API doesn't specify queue time

// --- ROTATION & LOGIC CONSTANTS ---
const ROTATION_INTERVAL_MS = 8 * 60 * 1000 
const OVERLAP_TIME_MS = 10000 
const POLLING_INTERVAL_MS = 5 * 60 * 1000 

const ACTION_INTERVAL = 10000 
const GREETING_CHAT_DELAY = 3000 

// Define the four bots and their unique usernames
const BOT_ACCOUNTS = [
    { username: "Madara" },
    { username: "Obito" },
    { username: "Shisui" },
    { username: "Satro_gojo" }
]

const GREETINGS = [
    "Welcome to the server, {PLAYER}! I'm {BOT}, here to keep the server alive for you.",
    "Hey, {PLAYER}! Glad you could make it. I'm {BOT}, and my shift just started!",
    "A wild {PLAYER} has appeared! Welcome aboard. I'm {BOT}, the current Guardian.",
    "Howdy, {PLAYER}! {BOT} reporting for duty. Have fun!",
]

// --- State and Initialization Check ---

if (!HOST) {
    console.error('ERROR: HOST environment variable is missing from config.env')
    process.exit(1)
}

// --- Global State ---
let currentBotIndex = 0 
let bots = {} 
let swapInterval = null 
let pollingTimeout = null 
let standbyStartTime = null 
let isPollingMode = false 

// --- Aternos Server Start Function (UPDATED) ---

/**
 * Starts the external script to automate the Aternos web panel startup process 
 * via API calls and handles the waiting period.
 */
function startAternosServer() {
    console.log('\n[Aternos AUTO-START] Starting server via API automation...')
    
    // Execute the aternos_api_starter.js script as a child process
    const starter = spawn('node', ['aternos_api_starter.js'])
    
    let scriptOutput = '';
    starter.stdout.on('data', (data) => {
        // Collect all output from the starter script
        scriptOutput += data.toString();
        process.stdout.write(data); // Also pipe output to main console
    });
    
    starter.stderr.on('data', (data) => {
        process.stderr.write(data); // Pipe errors to main console
    });

    starter.on('error', (err) => {
        console.error(`[Aternos Start Error] Failed to run server script. Have you installed 'node-fetch'? Error: ${err.message}`)
    })

    starter.on('close', (code) => {
        console.log(`[Aternos AUTO-START] API script finished with code ${code}.`)
        
        let waitTimeSeconds = DEFAULT_RECONNECT_WAIT_MS / 1000;
        
        // Try to extract the dynamic wait time from the starter script's output
        const match = scriptOutput.match(/WAIT_TIME_SECONDS:(\d+)/);
        if (match && match[1]) {
            waitTimeSeconds = parseInt(match[1], 10);
            // Add a small buffer for server initialization
            waitTimeSeconds += 15; 
            console.log(`[Aternos AUTO-START] Detected dynamic queue time. Waiting ${waitTimeSeconds} seconds.`);
        } else {
            console.log(`[Aternos AUTO-START] Using default wait time of ${waitTimeSeconds} seconds.`);
        }

        const waitTimeMs = waitTimeSeconds * 1000;
        
        // After the starter script runs, resume connection attempts after the queue time.
        setTimeout(startHotSwap, waitTimeMs); 
    })
}

// --- Core Bot Logic (Unchanged) ---

function randomAFKAction(bot) {
    if (!bot || !bot.entity) return

    if (bot.pathfinder) bot.pathfinder.stop() 
    
    bot.setControlState('forward', false)
    bot.setControlState('sneak', false)
    bot.setControlState('jump', false)
    bot.setControlState('back', false)

    const actions = ['move_forward', 'sneak', 'look_around', 'jump']
    const action = actions[Math.floor(Math.random() * actions.length)]

    switch (action) {
        case 'move_forward':
            bot.setControlState('forward', true)
            break
        case 'sneak':
            bot.setControlState('sneak', true)
            break
        case 'look_around':
            const yaw = Math.random() * Math.PI * 2
            const pitch = (Math.random() * Math.PI / 2) - (Math.PI / 4) 
            bot.look(yaw, pitch, true)
            break
        case 'jump':
            if (bot.entity.onGround) {
                 bot.setControlState('jump', true)
                 setTimeout(() => bot.setControlState('jump', false), 500) 
            }
            break
    }
}

async function trySleep(bot) {
    if (bot.time.timeOfDay < 13000 || bot.time.timeOfDay > 23450 || bot.isSleeping) {
        return false 
    }
    
    const bedBlock = bot.findBlock({
        matching: (block) => block.name.includes('bed'),
        maxDistance: 32, 
    })

    if (bedBlock) {
        console.log(`🛌 ${bot.username} found a bed. Heading there...`)

        const p = bot.pathfinder
        const goal = new Goals.GoalNear(bedBlock.position.x, bedBlock.position.y, bedBlock.position.z, 1)
        
        try {
            await p.goto(goal)
            await bot.sleep(bedBlock)
            bot.isSleeping = true
            console.log(`😴 ${bot.username} is now sleeping.`)
            return true
        } catch (err) {
            console.warn(`⚠️ Could not sleep: ${err.message}`)
            if (bot.pathfinder) bot.pathfinder.stop()
            return false
        }
    } else {
        return false
    }
}

async function handleSleepAndAFK(bot) {
    if (bot.isSleeping) {
        return
    }
    
    const activeBotConfig = BOT_ACCOUNTS[currentBotIndex]
    if (bot.username !== activeBotConfig.username) {
        randomAFKAction(bot) 
        return
    }

    const startedSleeping = await trySleep(bot)
    
    if (!startedSleeping) {
        randomAFKAction(bot)
    }
}

function handlePlayerJoinedChat(bot, player) {
    if (player.username !== bot.username) {
        console.log(`[Event] Player joined: ${player.username}`)
        
        setTimeout(() => {
            if (bot.entity) { 
                const randomIndex = Math.floor(Math.random() * GREETINGS.length)
                const rawMessage = GREETINGS[randomIndex]
                
                const message = rawMessage
                    .replace('{PLAYER}', player.username)
                    .replace('{BOT}', bot.username)

                bot.chat(message)
                console.log(`[Chat Sent] Greeting delivered by ${bot.username}.`)
            }
        }, GREETING_CHAT_DELAY) 
    }
}


// --- Player/Standby Logic (Polling) ---

function getHumanPlayerCount(bot) {
    if (!bot || !bot.players) return 0
    
    const botUsernames = BOT_ACCOUNTS.map(a => a.username)
    
    const humanPlayers = Object.keys(bot.players).filter(
      p => !botUsernames.includes(p)
    ).length
    
    return humanPlayers
}

function checkAndManageConnection(bot) {
    const count = getHumanPlayerCount(bot)
    
    if (count > MAX_HUMAN_PLAYERS) {
        console.log(`[Status] Human players: ${count}.`)
        handlePlayerLimit(count)
    } else if (isPollingMode) {
        exitPollingMode(count)
    } else {
        console.log(`[Status] Human players: ${count}. Hot-Swap continues.`)
    }
}

function handlePlayerLimit (count) {
    if (isPollingMode) return 

    console.log(`\n✨ PLAYER LIMIT REACHED! ${count} human players are online (Target: ${MAX_HUMAN_PLAYERS}).`)
    console.log(`Entering POLLING STANDBY MODE. All bots disconnecting...`)
    
    isPollingMode = true
    standbyStartTime = Date.now()
    
    if (swapInterval) clearInterval(swapInterval)

    for (const name in bots) {
        if (bots[name]) {
            if (bots[name].afkInterval) clearInterval(bots[name].afkInterval)
            bots[name].quit('disconnect.quitting')
        }
    }
    bots = {} 

    startPollingWait()
}

function startPollingWait() {
    if (!isPollingMode) return

    const elapsedMinutes = (Date.now() - standbyStartTime) / 1000 / 60
    
    console.log(`\n💤 Entering Polling Wait. Waiting ${POLLING_INTERVAL_MS / 1000 / 60} minutes before next check. (Total standby: ${elapsedMinutes.toFixed(0)} minutes)`)
    
    pollingTimeout = setTimeout(() => {
        createBotInstance(BOT_ACCOUNTS[0].username, true) 
    }, POLLING_INTERVAL_MS)
}

function exitPollingMode(count) {
    console.log(`\n✅ POLLING SUCCESS! Human players are now ${count}. Resuming full AFK duty.`)
    
    if (pollingTimeout) clearTimeout(pollingTimeout)
    if (bots[BOT_ACCOUNTS[0].username]) {
        bots[BOT_ACCOUNTS[0].username].quit('disconnect.quitting')
    }
    
    isPollingMode = false
    
    startHotSwap()
}

// --- Hot Swap Logic (4-Bot Rotation) ---

function startRotation(bot) {
    if (bot.afkInterval) clearInterval(bot.afkInterval)
    bot.afkInterval = setInterval(() => handleSleepAndAFK(bot), ACTION_INTERVAL)
}

function initiateSwap() {
    if (isPollingMode) return
    
    const currentBotConfig = BOT_ACCOUNTS[currentBotIndex]
    
    const nextBotIndex = (currentBotIndex + 1) % BOT_ACCOUNTS.length
    const standbyBotConfig = BOT_ACCOUNTS[nextBotIndex]
    
    console.log(`\n🔄 INITIATING SWAP: ${currentBotConfig.username} -> ${standbyBotConfig.username}`)
    
    createBotInstance(standbyBotConfig.username)
}

function completeSwap(newActiveBot) {
    if (isPollingMode) return

    const oldBotName = BOT_ACCOUNTS[currentBotIndex].username
    const oldBot = bots[oldBotName]
    
    if (!oldBot) {
        console.warn(`[HANDOVER ERROR] Old bot (${oldBotName}) not found. Assuming disconnected.`)
    } else {
        console.log(`[HANDOVER] ${OVERLAP_TIME_MS / 1000}s overlap complete. Quitting ${oldBot.username}...`)
        if (oldBot.afkInterval) clearInterval(oldBot.afkInterval)
        oldBot.quit('disconnect.quitting')
    }
    
    currentBotIndex = BOT_ACCOUNTS.findIndex(b => b.username === newActiveBot.username)
    delete bots[oldBotName]

    startRotation(newActiveBot)
}

/**
 * Initializes and connects a bot instance.
 */
function createBotInstance(username, isPollingCheck = false) {
    const botConfig = BOT_ACCOUNTS.find(b => b.username === username)
    
    const newBot = mineflayer.createBot({
        host: HOST,
        port: PORT,
        username: botConfig.username,
        version: VERSION,
        auth: 'offline', 
    })
    bots[username] = newBot
    newBot.isSleeping = false 
    
    console.log(`\nAttempting to connect ${username} to ${HOST}:${PORT} (v${VERSION})...`)

    newBot.loadPlugin(pathfinder)
    newBot.once('spawn', () => {
        const defaultMove = new Movements(newBot)
        newBot.pathfinder.setMovements(defaultMove)
    })

    newBot.on('spawn', () => {
        console.log(`✅ ${newBot.username} has spawned!`)
        
        checkAndManageConnection(newBot)

        if (isPollingCheck) {
            newBot.pollingExitTimeout = setTimeout(() => {
                console.log(`[Polling Check] Timeout reached. Quitting ${newBot.username}.`)
                newBot.quit('disconnect.quitting')
            }, 30000); 
        } else {
            if (newBot.username === BOT_ACCOUNTS[currentBotIndex].username) {
                startRotation(newBot)
            } else {
                setTimeout(() => completeSwap(newBot), OVERLAP_TIME_MS)
            }
        }
    })

    newBot.on('wake', () => {
        newBot.isSleeping = false
        console.log(`☀️ ${newBot.username} woke up! Resuming AFK actions.`)
        startRotation(newBot)
    })

    newBot.on('playerJoined', (player) => {
        handlePlayerJoinedChat(newBot, player)
        checkAndManageConnection(newBot)
    })

    newBot.on('playerLeft', () => checkAndManageConnection(newBot))
    
    // MODIFIED 'end' HANDLER TO CALL ATERNOS AUTO-START
    newBot.on('end', (reason) => {
        if (newBot.pollingExitTimeout) clearTimeout(newBot.pollingExitTimeout)
        if (newBot.afkInterval) clearInterval(newBot.afkInterval)

        delete bots[newBot.username]
        console.warn(`\n🛑 ${newBot.username} disconnected. Reason: ${reason}.`)
        
        // --- ATERNOS AUTO-START LOGIC ---
        // If the server is offline (indicated by a connection error), attempt to start it.
        if (reason.includes('No route to host') || reason.includes('timed out') || reason.includes('ECONNREFUSED')) {
            if (swapInterval) clearInterval(swapInterval)
            
            // Start the external web automation script
            startAternosServer()
            return; 
        }
        // --- END ATERNOS AUTO-START LOGIC ---
        
        if (isPollingMode && reason !== 'disconnect.quitting') {
             startPollingWait()
        } else if (!isPollingMode && reason !== 'disconnect.quitting') {
            console.error(`CRITICAL: Active bot crashed! Restarting full cycle in 30s.`)
            if (swapInterval) clearInterval(swapInterval)
            
            currentBotIndex = (currentBotIndex + 1) % BOT_ACCOUNTS.length
            setTimeout(startHotSwap, 30000) 
        }
    })

    newBot.on('error', (err) => {
        console.error(`\n🔥 Bot Error [${newBot.username}]: ${err.message}`)
        
        // Treat connection errors during initial attempt as server being offline
        if (err.message.includes('No route to host') || err.message.includes('timed out') || err.message.includes('ECONNREFUSED')) {
            if (swapInterval) clearInterval(swapInterval)
            
            // Start the external web automation script
            startAternosServer()
            return;
        }
    })
}

function startHotSwap() {
    if (isPollingMode) return

    const initialBotConfig = BOT_ACCOUNTS[currentBotIndex]
    createBotInstance(initialBotConfig.username)
    
    if (swapInterval) clearInterval(swapInterval) 
    swapInterval = setInterval(initiateSwap, ROTATION_INTERVAL_MS)
}

// Start the entire system
startHotSwap()
