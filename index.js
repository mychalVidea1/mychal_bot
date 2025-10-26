require('dotenv').config();
const path = require('path');
const cron = require('node-cron');
const Canvas = require('canvas');
const crypto = require('crypto');
const { AttachmentBuilder } = require('discord.js');
Canvas.registerFont('./assets/Quicksand-Bold.ttf', { family: 'Quicksand' });
const { format } = require('date-fns');
const { utcToZonedTime } = require('date-fns-tz');
const { GoogleGenAI } = require("@google/genai");
const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, MessageFlags, Collection, ActivityType } = require('discord.js');
const fs = require('fs');
const axios = require('axios');
const sharp = require('sharp');
const getFrames = require('gif-frames');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

// ======================= NASTAVENÍ =======================
const prefix = 'm!';
const roleId = process.env.ROLE_ID;
const geminiApiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const tenorApiKey = process.env.TENOR_API_KEY;
const countingChannelId = '1007100284562055298';
const countingFilePath = './data/counting.json';
const ownerRoleId = '875091178322812988';
const activityChannelId = '875097279650992128';
const logChannelId = '1025689879973203968';
const startupChannelId = '1025689879973203968';
const aiModerationChannelIds = ['875097279650992128', '1261094481415897128', '1275999194313785415', '1322337083745898616', '1419340737048350880'];
const svatekBypassChannelId = '1414000469684129872';
const svatekAutoChannelId = '875097279650992128';
const SVATEK_COOLDOWN_MINUTES = 5;
let lastSvatekTimestamp = 0;
const MAX_WORDS_FOR_AI = 100;
const MIN_CHARS_FOR_AI = 4;
const COOLDOWN_SECONDS = 6;
const chatCooldowns = new Map();
const CHAT_COOLDOWN_SECONDS = 30; // Cooldown 15 sekund speciálně pro /chat
const NOTIFICATION_COOLDOWN_MINUTES = 10;
const otherBotPrefixes = ['?', '!', 'db!', 'c!', '*'];
const emojiSpamRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|<a?:\w+:\d+>){10,}/;
const mediaUrlRegex = /https?:\/\/(media\.tenor\.com|tenor\.com|giphy\.com|i\.imgur\.com|cdn\.discordapp\.com|media\.discordapp\.net|img\.youtube\.com)\S+/i;
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const allowedGuildId = '875027587477409862';

const activeImageModel = 'gemini-2.5-pro';
const firstFallbackImageModel = 'gemini-1.5-pro-latest';

const level3Words = [ 'nigga', 'n1gga', 'n*gga', 'niggas', 'nigger', 'n1gger', 'n*gger', 'niggers', 'niga', 'n1ga', 'nygga', 'niggar', 'negr', 'ne*r', 'n*gr', 'n3gr', 'neger', 'negri', 'negry', 'Niger', 'negřík' ];
const level2Words = [ 'kretén', 'sračka', 'píčo', 'pičo', 'fakin', 'píča', 'píčus', 'picus', 'zkurvysyn', 'zmrd', 'zmrde', 'dopíči', 'dokundy', 'kundo', 'kundy', 'čuráku', 'curaku', 'čůráku', 'mrdko', 'buzerant', 'buzna', 'kurva', 'kurvo', 'kurvy', 'čurák', 'curak', 'šukat', 'mrdat', 'bitch', 'b*tch', 'whore', 'slut', 'faggot', 'motherfucker', 'asshole', 'assh*le', 'bastard', 'cunt', 'c*nt', 'dickhead', 'dick', 'pussy', 'fuck', 'f*ck', 'fck', 'kys', 'kill yourself', 'go kill yourself', 'zabij se', 'fuk', 'hitler' ];
const level1Words = [ 'vole', 'kokot', 'kokote'];

const level3Regex = new RegExp(`\\b(${level3Words.join('|')})\\b`, 'i');
const level2Regex = new RegExp(`\\b(${level2Words.join('|')})\\b`, 'i');
const level1Regex = new RegExp(`\\b(${level1Words.join('|')})\\b`, 'i');

const userCooldowns = new Map();
let lastLimitNotificationTimestamp = 0;

const chatHistory = new Map();
const SPAM_MESSAGE_COUNT = 5;
const SPAM_MAX_MESSAGE_LENGTH = 4;
const userMessageHistory = new Collection();
const userImagePostHistory = new Map();
const IMAGE_LIMIT = 3;
const IMAGE_LIMIT_TIMEFRAME_MS = 60 * 1000;
const MAX_CHAT_TURNS = 20;

const dataDirectory = './data';
const ratingsFilePath = `${dataDirectory}/ratings.json`;
const messageCountsFilePath = `${dataDirectory}/message_counts.json`;

if (!fs.existsSync(dataDirectory)) fs.mkdirSync(dataDirectory);
let ratings = {};
try { ratings = JSON.parse(fs.readFileSync(ratingsFilePath, 'utf8')); } catch (err) {}
let messageCounts = {};
try { messageCounts = JSON.parse(fs.readFileSync(messageCountsFilePath, 'utf8')); } catch (err) {}

const pendingSaves = new Set();
function scheduleSave(filePath, dataGetter) {
  if (pendingSaves.has(filePath)) return; // už je naplánováno
  pendingSaves.add(filePath);

  setTimeout(() => {
    pendingSaves.delete(filePath);
    try {
      const tempPath = filePath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(dataGetter(), null, 2));
      fs.renameSync(tempPath, filePath);
      console.log(`[SAVE] Soubor ${path.basename(filePath)} uložen.`);
    } catch (err) {
      console.error(`[SAVE] Chyba při ukládání ${filePath}:`, err);
    }
  }, 2000); // 2 sekundy zpoždění — můžeš klidně zvýšit na 5000
}

function loadCountingState() {
    try {
        const data = fs.readFileSync(countingFilePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error("Chyba při načítání stavu počítání, resetuji na 0.", err);
        return { currentCount: 0, lastUser: null };
    }
}

function saveCountingState(state) {
    try {
        fs.writeFileSync(countingFilePath, JSON.stringify(state, null, 2));
    } catch (err) {
        console.error("Chyba při ukládání stavu počítání:", err);
    }
}

let countingState = loadCountingState();

function saveRatings() {
    scheduleSave(ratingsFilePath, () => ratings);
}
function saveMessageCounts() {
    scheduleSave(messageCountsFilePath, () => messageCounts);
}

function getUserRating(userId) {
    const userData = ratings[userId];
    if (typeof userData === 'object' && userData !== null && userData.score !== undefined) {
        return userData.score;
    }
    return userData || 0.0;
}

function updateRating(user, points, reason = "") {
    const userId = user.id;
    const currentRating = getUserRating(userId);
    const newRating = Math.max(0, Math.min(10, currentRating + points));

    ratings[userId] = {
        score: newRating,
        username: user.tag 
    };

    saveRatings();
    
    console.log(`[RATING] Uživatel ${user.tag} (${userId}) obdržel ${points} bodů. Nové skóre: ${newRating.toFixed(2)}. ${reason}`);
    console.log("--------------------------");
}

async function updateRoleStatus(userId, guild, sourceMessage = null) { try { if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return; const member = await guild.members.fetch(userId).catch(() => null); const role = guild.roles.cache.get(roleId); if (!member || !role) return; const userRating = getUserRating(userId); const hasRole = member.roles.cache.has(roleId); if (userRating > 9 && !hasRole) { await member.roles.add(role); const messageContent = `🎉 Gratulace, <@${member.id}>! Tvé skóre tě katapultovalo mezi elitu a získal(a) jsi roli **${role.name}**! 🚀`; if (sourceMessage && sourceMessage.channel && !sourceMessage.deleted) { sourceMessage.reply(messageContent).catch(() => {}); } else { const channel = await client.channels.fetch(logChannelId).catch(() => null); if (channel) channel.send(messageContent).catch(() => {}); } } else if (userRating <= 9 && hasRole) { await member.roles.remove(role); const messageContent = `📉 Pozor, <@${member.id}>! Tvé hodnocení kleslo a přišel(a) jsi o roli **${role.name}**. Zaber!`; if (sourceMessage && sourceMessage.channel && !sourceMessage.deleted) { sourceMessage.reply(messageContent).catch(() => {}); } else { const channel = await client.channels.fetch(logChannelId).catch(() => null); if (channel) channel.send(messageContent).catch(() => {}); } } } catch (error) { console.error(`[ROLE ERROR] Chyba při aktualizaci role pro ${userId}:`, error); console.log("--------------------------"); } }

async function applyTimeout(member, durationInMs, reason) {
    if (!member) return;
    try {
        await member.timeout(durationInMs, reason);
        console.log(`[MOD] Uživatel ${member.user.tag} dostal timeout na ${durationInMs / 1000}s. Důvod: ${reason}`);
        console.log("--------------------------");
    } catch (error) {
        console.error(`[MOD ERROR] Nepodařilo se udělit timeout uživateli ${member.user.tag}:`, error.message);
        console.log("--------------------------");
    }
}

let useModel20 = true;

async function getGeminiChatResponse(text, username, context = "") {
    if (level3Regex.test(text) || level2Regex.test(text)) {
        return 'FORBIDDEN_CONTENT';
    }

    const contextBlock = context 
        ? `--- ZDE JE PŘEDCHOZÍ KONVERZACE PRO KONTEXT ---\n${context}\n---------------------------------------------\n` 
        : '';

    const prompt = `Jsi humorný a pomocný AI moderátor na discord serveru streamera / youtubera "mychalVidea" (na discordu pod nickem "@mychalvidea" - jenom takhle žádná jina forma!), hrajeme tu Fortnite (většina), CS2 (csko), Minecraft (už moc ne), *občas* dáme Forzu Horizon (ještě zkousneme Roblox, ale Valorant a League of Legends nemame radi), kdyby se někdo ptal nebo zdálo se že chce poradit tak mu poraď, když ti napíše mychal musíš být upřímný, mychal má ve Fortnite support-a-creator (sac) kód "mychal", lidi tě nazývají "🍀 SAC MYCHAL 🍀" (tvuj oficiální nick) a dále máš přiložený nick každého uživatele tak si s tím pohraj klidně i pošťouchni. Příkazy které můžou členové zadat, kdyby se někdo ptal: "/chat - Pošle zprávu AI. /score - Zobrazí hodnocení chování (nebo hodnocení chování jiného uživatele). /scoreboard - Ukáže žebříček nejlépe hodnocených uživatelů. /svatek - Ukáže kdo má dneska svátek., /profil - vytvoří se profilová kartička, která shrnuje základní informace o uživateli na serveru" Tvým úkolem je bavit se s uživateli jako člověk (ale ty jako bot nemůžeš hrát hry, nebav se příliš o hrách). Žádný rasizmus a nenávistný projev a zkus omezit vyšší toxicitu (lehčí trash talk je povolen). Odpověz na následující zprávu stručně, vtipně a neformálně. Tvoje odpověď musí mít maximálně 70 slov. ${contextBlock} Uživatel "${username}" napsal: "${text}" Ty:`;

    const model = useModel20 ? "gemini-2.0-flash" : "gemini-2.5-flash";
    useModel20 = !useModel20;

    try {
        const response = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: prompt }] }]
        });
        console.log(`[AI CHAT] Model: ${model} | Od: ${username} | Napsal: "${text}"`);
        console.log("--------------------------");
        return response.text || `AI selhala. (${model})`;

    } catch (error) {
        console.error(`[AI ERROR] Chyba u ${model}:`, error.message);
        console.log("--------------------------");

        const fallbackModel = model === "gemini-2.0-flash" ? "gemini-2.5-flash" : "gemini-2.0-flash";
        try {
            const response = await ai.models.generateContent({
                model: fallbackModel,
                contents: [{ role: "user", parts: [{ text: prompt }] }]
            });
            return response.text || `AI neposlala žádnou odpověď. (${fallbackModel})`;
        } catch (err) {
            if (err.status === 429) {
                return "Vyčerpal jsi dnešní free limit pro AI. Zkus to zase zítra 🍀";
            }
            return "Něco se pokazilo a AI nemůže odpovědět.";
        }
    }
}

async function analyzeText(textToAnalyze, context) {
    if (!geminiApiKey) return false;
    const modelsToTry = ['gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'];
    let lastError = null;
    const prompt = `Jsi AI moderátor pro neformální herní Discord server. Tvým úkolem je odhalit zprávy, které jsou skutečně škodlivé. Ignoruj běžné lehčí nadávky, "trash talk" a vtipy. Zasáhni pokud zpráva obsahuje nenávistný projev, vážné vyhrožování, rasizmus (jakákoliv forma nwordu) nebo cílenou šikanu.\n---\nZDE JE KONTEXT PŘEDCHOZÍ KONVERZACE:\n${context || "Žádný kontext není k dispozici."}\n---\nNYNÍ POSUĎ POUZE TUTO NOVOU ZPRÁVU. JE TATO NOVÁ ZPRÁVA S OHLEDEM NA KONTEXT ZÁVAŽNÝM PORUŠENÍM PRAVIDEL?\nNová zpráva: "${textToAnalyze}"\n\nOdpověz jen "ANO" nebo "NE".`;
    
    const contents = [{ role: "user", parts: [{ text: prompt }] }];
    const generationConfig = { maxOutputTokens: 15 };

    for (const model of modelsToTry) {
        try {
            const response = await ai.models.generateContent({
                model: model,
                contents: contents,
                generationConfig: generationConfig
            });
            
            console.log(`[AI MOD CHECK] Kontrola textu modelem: ${model}, Text: ${textToAnalyze}`);
            const candidateText = response.text;

            if (candidateText) {
                return candidateText.trim().toUpperCase().includes("ANO");
            }
            lastError = new Error(`Blocked by safety filter on model ${model}`);
            continue;
        } catch (error) {
            lastError = error;
            const status = error.status || (error.response ? error.response.status : null);
            if (status === 429 || status === 500 || status === 404) {
                console.warn(`[AI MOD CHECK] Model ${model} selhal se statusem ${status}. Zkouším další...`);
                continue;
            } else { 
                break; 
            }
        }
    }
    
    const lastStatus = lastError?.status || (lastError?.response ? lastError.response.status : null);
    if (lastStatus === 429) return 'API_LIMIT';

    console.error(`[AI MOD ERROR] Všechny modely pro analýzu textu selhaly. Poslední chyba:`, lastError?.message);
    console.log("--------------------------");
    return false;
}

async function checkTenorGif(gifUrl) {
    if (!tenorApiKey) return 'needs_analysis';
    const match = gifUrl.match(/-(\d+)$/) || gifUrl.match(/\/(\d+)\.gif/);
    if (!match) return 'needs_analysis';
    const gifId = match[1];
    try {
        const url = `https://tenor.googleapis.com/v2/posts?ids=${gifId}&key=${tenorApiKey}&media_filter=minimal`;
        const response = await axios.get(url);
        const gifData = response.data?.results?.[0];
        if (!gifData) return 'needs_analysis';
        const rating = gifData.content_rating;
        if (rating === 'rated_r') {
            console.log(`[TENOR CHECK] Tenor API označilo GIF ${gifId} jako nevhodný (rated_r).`);
            console.log("--------------------------");
            return 'inappropriate';
        }
        console.log(`[TENOR CHECK] Tenor API označilo GIF ${gifId} jako bezpečný (${rating}).`);
        console.log("--------------------------");
        return 'safe';
    } catch (error) {
        console.error("[TENOR ERROR] Chyba při komunikaci s Tenor API:", error.message);
        console.log("--------------------------");
        return 'needs_analysis';
    }
}

async function analyzeImage(imageBuffer, mimeType) {
  if (!geminiApiKey) return false;

  // Krok 1: Předzpracování obrázku
  try {
    if (typeof mimeType !== 'string' || !mimeType.startsWith('image/')) {
      console.warn(`[IMAGE ANALYZE] Přeskočena analýza, soubor není obrázek: ${mimeType}`);
      return false;
    }

    // Pokud je GIF, vytáhneme prostřední snímek a převedeme na PNG
    if (mimeType.startsWith('image/gif')) {
      console.log(`[IMAGE ANALYZE] Zpracovávám GIF...`);
      const meta = await sharp(imageBuffer, { animated: true }).metadata();
      const pages = Number(meta.pages) > 0 ? Number(meta.pages) : 1;
      const middleFrameIndex = Math.max(0, Math.min(pages - 1, Math.floor(pages / 2)));

      imageBuffer = await sharp(imageBuffer, { animated: true })
        .extractFrame(middleFrameIndex)
        .png()
        .toBuffer();

      mimeType = 'image/png';
      console.log(`[IMAGE ANALYZE] GIF převeden na PNG (frame ${middleFrameIndex + 1}/${pages}).`);
    }

    // Jednotné zmenšení pro všechny image typy (vč. PNG z GIFu)
    console.log(`[IMAGE ANALYZE] Měním velikost obrázku (${mimeType})...`);
    imageBuffer = await sharp(imageBuffer)
      .resize({ width: 512, withoutEnlargement: true })
      .toBuffer();
    console.log(`[IMAGE ANALYZE] Velikost obrázku úspěšně změněna.`);
  } catch (processingError) {
    console.error("[IMAGE ANALYZE ERROR] Chyba při PŘEDZPRACOVÁNÍ obrázku:", processingError.message);
    console.log("--------------------------");
    return 'FILTERED';
  }

  // Krok 2: Odeslání do Gemini API
  const modelsToTry = [activeImageModel, firstFallbackImageModel];
  const base64Image = imageBuffer.toString('base64');
  const prompt = `Jsi AI moderátor pro herní Discord server. Posuď, jestli je tento obrázek skutečně nevhodný pro komunitu (pornografie, gore, explicitní násilí, nenávistné symboly, rasismus). Ignoruj herní násilí (střílení ve hrách), krev ve hrách, herní rozhraní (UI) a běžné internetové memy, které nejsou extrémní. Buď shovívavý k textu na screenshotech. Odpověz jen "ANO" (pokud je nevhodný) nebo "NE" (pokud je v pořádku).`;

  const imagePart = {
    inlineData: {
      mimeType: mimeType,
      data: base64Image,
    },
  };

  const contents = [{ role: 'user', parts: [{ text: prompt }, imagePart] }];

  for (const modelName of modelsToTry) {
    try {
      console.log(`[AI IMAGE CHECK] Kontrola obrázku modelem: ${modelName}`);
      const response = await ai.models.generateContent({
        model: modelName,
        contents: contents,
      });

      const responseText = response?.text;
      if (!responseText) {
        console.warn(`[AI IMAGE CHECK] Model ${modelName} vrátil prázdnou odpověď.`);
        continue;
      }

      const result = responseText.trim().toUpperCase();
      console.log(`[AI IMAGE CHECK] Model ${modelName} odpověděl: "${result}"`);
      console.log("--------------------------");
      return result.includes("ANO");
    } catch (error) {
      const status = error.status || (error.response ? error.response.status : null);
      console.warn(`[AI IMAGE CHECK] Model ${modelName} selhal se statusem ${status || 'N/A'}. Zpráva: ${error.message}`);
      console.log("--------------------------");
      if (status === 429 || status === 404 || status === 500 || status === 503) {
        continue;
      } else {
        break;
      }
    }
  }

  console.error(`[AI IMAGE CHECK] Všechny modely selhaly. Obrázek vyžaduje manuální kontrolu.`);
  console.log("--------------------------");
  return 'FILTERED';
}


async function getNamenstagInfo() {
    try {
        const cacheBuster = Date.now();
        const czApiUrl = `https://svatkyapi.cz/api/day?_=${cacheBuster}`;
        const skApiUrl = `https://nameday.abalin.net/api/V2/today/cz?_=${cacheBuster}`;

        console.log(`[SVATEK API] Volám API s cache busterem: ${cacheBuster}`);
        
        const requestHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        };

        const [czResponse, skResponse] = await Promise.all([
            axios.get(czApiUrl, { headers: requestHeaders }),
            axios.get(skApiUrl, { headers: requestHeaders })
        ]);

        const czName = czResponse.data?.name || 'Neznámý';
        const skName = skResponse.data?.data?.sk || 'Neznámy';

        console.log(`[SVATEK API] Načteno: CZ=${czName}, SK=${skName}`);
        console.log("--------------------------");

        return { cz: czName, sk: skName };

    } catch (error) {
        if (error.response) {
            console.error("[SVATEK ERROR] Chyba při volání finálních API s cache busterem!");
            console.error("Status:", error.response.status, "URL:", error.config.url);
            console.error("Data:", error.response.data);
        } else {
            console.error("[SVATEK ERROR] Došlo k chybě při komunikaci s finálními API:", error.message);
        }
        console.log("--------------------------");
        return null;
    }
}

async function moderateMessage(message) {
    if (!message.guild || !message.author || message.author.bot) return false;
    const member = message.member;
    if (member && member.user.id === process.env.OWNER_ID) return false; 
    if (!member || member.roles.cache.has(ownerRoleId)) return false;
    if (!aiModerationChannelIds.includes(message.channel.id)) return false;

    const cleanedContent = message.content.replace(/^> ?/gm, '').trim();

    let mediaUrl = null;
    let attachment = null;
    if (message.attachments.size > 0) {
        const firstAttachment = message.attachments.first();
        if (firstAttachment.size < MAX_FILE_SIZE_BYTES && (firstAttachment.contentType?.startsWith('image/') || firstAttachment.contentType?.startsWith('video/'))) {
            mediaUrl = firstAttachment.url;
            attachment = firstAttachment;
        }
    }
    if (!mediaUrl && message.embeds.length > 0) {
        const embed = message.embeds[0];
        if (embed.image) mediaUrl = embed.image.url;
        else if (embed.thumbnail) mediaUrl = embed.thumbnail.url;
    }
    if (!mediaUrl) {
        const match = message.content.match(mediaUrlRegex);
        if (match) mediaUrl = match[0];
    }

    if (mediaUrl) {
        const now = Date.now();
        const userHistory = userImagePostHistory.get(message.author.id) || [];
        const recentPosts = userHistory.filter(timestamp => now - timestamp < IMAGE_LIMIT_TIMEFRAME_MS);
        if (recentPosts.length >= IMAGE_LIMIT) {
            await applyTimeout(member, 60 * 1000, 'Spamování obrázků');
            try {
                await message.delete();
                const warningMsg = await message.channel.send(`<@${message.author.id}>, posíláš obrázky příliš rychle! Počkej **60 sekund**.`);
                setTimeout(() => warningMsg.delete().catch(() => {}), 15000);
            } catch (err) { console.error("[MOD ERROR] Chyba při trestání za spam obrázků:", err); }
            userImagePostHistory.set(message.author.id, []);
            return true;
        }
        recentPosts.push(now);
        userImagePostHistory.set(message.author.id, recentPosts);
        
        const cleanMediaUrl = mediaUrl.split('?')[0];
        const isTenorGif = /https?:\/\/(media\.)?tenor\.com/.test(cleanMediaUrl);
        let tenorCheckResult = isTenorGif ? await checkTenorGif(cleanMediaUrl) : 'needs_analysis';

        if (tenorCheckResult === 'inappropriate') {
            updateRating(message.author, -1.5, `Důvod: Nevhodný GIF (Tenor API)`);
            await applyTimeout(member, 60 * 1000, 'Nevhodný GIF');
            await updateRoleStatus(message.author.id, message.guild, message);
            try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, tvůj GIF nebo obrázek byl nevhodný. Sníženo hodnocení a **timeout na 60 sekund**.`); setTimeout(() => warningMsg.delete().catch(() => {}), 15000); } catch (err) {}
            return true;
        }
        
        if (tenorCheckResult === 'needs_analysis') {
            try {
                console.log(`[MODERATE MESSAGE] Pokouším se stáhnout obrázek přes fetch: ${mediaUrl}`);
                const response = await fetch(mediaUrl);

                if (!response.ok) {
                    throw new Error(`Chyba serveru při stahování: Status ${response.status}`);
                }

                const arrayBuffer = await response.arrayBuffer();
                const imageBuffer = Buffer.from(arrayBuffer);
                const mimeType = attachment ? attachment.contentType : response.headers.get('content-type');

                const imageResult = await analyzeImage(imageBuffer, mimeType);
                
                if (imageResult === true) {
                    updateRating(message.author, -1.5, `Důvod: Nevhodný obrázek/GIF (AI)`);
                    await applyTimeout(member, 60 * 1000, 'Nevhodný obrázek');
                    await updateRoleStatus(message.author.id, message.guild, message);
                    try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, tvůj obrázek byl nevhodný. Sníženo hodnocení a **timeout na 60 sekund**.`); setTimeout(() => warningMsg.delete().catch(() => {}), 15000); } catch (err) {}
                    return true;
                } else if (imageResult === 'FILTERED') {
                    const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const embed = new EmbedBuilder().setColor('#FFA500').setTitle('⚠️ AI Moderace Selhala - Lidé k posouzení').setDescription(`AI nedokázala analyzovat obrázek od <@${message.author.id}>.\nŽádám o lidský posudek.`).setImage(mediaUrl).addFields({ name: 'Odkaz na zprávu', value: `[Klikni zde](${message.url})` }).setTimestamp();
                        const row = new ActionRowBuilder().addComponents( new ButtonBuilder().setCustomId(`approve-${message.id}-${message.author.id}`).setLabel('✅ Ponechat').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`punish-${message.id}-${message.author.id}`).setLabel('❌ Smazat a potrestat').setStyle(ButtonStyle.Danger) );
                        await logChannel.send({ embeds: [embed], components: [row] });
                    }
                }
            } catch (downloadError) {
                console.error("[MODERATE MESSAGE ERROR] Chyba při stahování obrázku pro analýzu (fetch):", downloadError.message);
                const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
                if (logChannel) {
                    const embed = new EmbedBuilder().setColor('#FFA500').setTitle('⚠️ AI Moderace Selhala - Chyba Stahování').setDescription(`Bot nedokázal stáhnout obrázek od <@${message.author.id}>.\nŽádám o lidský posudek.`).setImage(mediaUrl).addFields({ name: 'Odkaz na zprávu', value: `[Klikni zde](${message.url})` }).setTimestamp();
                    const row = new ActionRowBuilder().addComponents( new ButtonBuilder().setCustomId(`approve-${message.id}-${message.author.id}`).setLabel('✅ Ponechat').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`punish-${message.id}-${message.author.id}`).setLabel('❌ Smazat a potrestat').setStyle(ButtonStyle.Danger) );
                    await logChannel.send({ embeds: [embed], components: [row] });
                }
            }
        }
    }

    // Analýza textu
    let textToAnalyze = cleanedContent.replace(mediaUrlRegex, '').trim();
    if (textToAnalyze.length === 0 && message.embeds.length > 0) { const embed = message.embeds[0]; if (embed.description) textToAnalyze = embed.description.replace(/^> ?/gm, '').trim(); }
    if (textToAnalyze.length === 0) return false;

    if (level3Regex.test(textToAnalyze)) {
        ratings[message.author.id] = 0.0; saveRatings();
        await applyTimeout(member, 60 * 60 * 1000, 'Přísně zakázané slovo');
        await updateRoleStatus(message.author.id, message.guild, message);
        try { await message.delete(); const warningMsg = await message.channel.send(`Uživatel <@${message.author.id}> použil přísně zakázané slovo. Hodnocení **resetováno na 0** a **timeout na 1 hodinu**!`); setTimeout(() => warningMsg.delete().catch(() => {}), 20000); } catch (err) {}
        return true;
    }
    if (level2Regex.test(textToAnalyze)) {
        updateRating(message.author, -2, "Důvod: Hrubá urážka");
        await applyTimeout(member, 5 * 60 * 1000, 'Hrubá urážka');
        await updateRoleStatus(message.author.id, message.guild, message);
        try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, za toto chování ti byl snížen rating o **2 body** a udělen **timeout na 5 minut**.`); setTimeout(() => warningMsg.delete().catch(() => {}), 10000); } catch (err) {}
        return true;
    }
    if (level1Regex.test(textToAnalyze)) {
        try { await message.reply(`Slovník prosím. 🤫`);} catch (err) {}
        return true;
    }
    if (emojiSpamRegex.test(textToAnalyze)) {
        try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, tolik emoji není nutný! 😂`); setTimeout(() => warningMsg.delete().catch(() => {}), 10000); } catch (err) {}
        return true;
    }

    const wordCount = textToAnalyze.split(' ').length;
    if (textToAnalyze.length >= MIN_CHARS_FOR_AI && wordCount <= MAX_WORDS_FOR_AI) {
        const now = Date.now();
        const lastCheck = userCooldowns.get(message.author.id);
        if (!lastCheck || (now - lastCheck > COOLDOWN_SECONDS * 1000)) {
            userCooldowns.set(message.author.id, now);
            
            const lastMessages = await message.channel.messages.fetch({ limit: 3, before: message.id });
            const context = lastMessages.filter(m => !m.author.bot && m.content).map(m => `${m.author.username}: ${m.content.replace(/^> ?/gm, '').trim()}`).reverse().join('\n');
            const toxicityResult = await analyzeText(textToAnalyze, context);
            
            if (toxicityResult === true) {
                updateRating(message.author, -1, `Důvod: Toxická zpráva (AI)`);
                await updateRoleStatus(message.author.id, message.guild, message);
                try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, tvá zpráva byla nevhodná, hodnocení sníženo o **1 bod**.`); setTimeout(() => warningMsg.delete().catch(() => {}), 15000); } catch (err) {}
                return true;
            } else if (toxicityResult === 'API_LIMIT') {
                if (Date.now() - lastLimitNotificationTimestamp > NOTIFICATION_COOLDOWN_MINUTES * 60 * 1000) {
                    lastLimitNotificationTimestamp = Date.now();
                    try { const reply = await message.reply(`AI si dala šlofíka, zpráva nebyla ověřena.`); setTimeout(() => reply.delete().catch(() => {}), 300000); } catch(err) {}
                }
            }
        }
    }
    return false;
}

async function checkRepetitiveSpam(message) {
  if (!message.guild || message.author.bot) return false;

  // --- konfigurace (máš-li globálně, tohle smaž) ---
  // const SPAM_MESSAGE_COUNT = 5;
  // const SPAM_MAX_MESSAGE_LENGTH = 60;
  // -------------------------------------------------

  // Udržujeme historii uživatele (FIFO) jen na posledních SPAM_MESSAGE_COUNT zpráv
  const userHistory = userMessageHistory.get(message.author.id) || new Collection();
  userHistory.set(message.id, message);
  if (userHistory.size > SPAM_MESSAGE_COUNT) {
    // smaž nejstarší (FIFO)
    const firstKey = userHistory.firstKey();
    if (firstKey) userHistory.delete(firstKey);
  }
  userMessageHistory.set(message.author.id, userHistory);

  if (userHistory.size < SPAM_MESSAGE_COUNT) return false;

  // Normalizace obsahu – zjednoduší detekci "aaaa", "A A  A" apod.
  const norm = (s) => (s || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const firstMessageContent = norm(userHistory.first().content || "");
  const isSpam = firstMessageContent.length > 0
    && firstMessageContent.length <= SPAM_MAX_MESSAGE_LENGTH
    && userHistory.every(msg => norm(msg.content || "") === firstMessageContent);

  if (!isSpam) return false;

  // Připrav zprávy ke smazání: jen z tohoto kanálu, max 100, mladší než 14 dní
  const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const deletable = [...userHistory.values()]
    .filter(m =>
      m.channelId === message.channelId &&
      (now - (m.createdTimestamp || now)) < FOURTEEN_DAYS
    )
    .slice(0, 100); // limit Discord API

  try {
    if (deletable.length > 0) {
      // v14 umí Collection/Array<Message|Snowflake>
      await message.channel.bulkDelete(deletable);
    }

    // Timeout (mute) za spam – 60 s
    await applyTimeout(message.member, 60 * 1000, 'Spamování krátkých opakujících se zpráv');

    const warningMsg = await message.channel.send(
      `<@${message.author.id}>, přestaň spamovat! **Timeout na 60 sekund**.`
    );
    setTimeout(() => warningMsg.delete().catch(() => {}), 15_000);

  } catch (err) {
    console.error("[SPAM ERROR] Chyba při mazání/timeoutu:", err);
    console.log("--------------------------");
  } finally {
    // vyčisti historii, ať se to zbytečně nehromadí
    userHistory.clear();
    userMessageHistory.set(message.author.id, userHistory);
  }

  return true;
}


client.once('clientReady', async () => {
    console.log(`[BOT STATUS] Bot je online jako ${client.user.tag}!`);
    console.log("--------------------------");
    const statuses = [
        { name: 'tvoje chování 👀', type: ActivityType.Watching },
        { name: 'skóre v síni slávy!', type: ActivityType.Watching },
        { name: 'hádky...', type: ActivityType.Listening },
        { name: 'mychalovi videjka...', type: ActivityType.Watching },
        { name: 'příkazy /chat', type: ActivityType.Listening },
        { name: 'kdo má ODBĚR!', type: ActivityType.Watching },
        { name: 'zda používáš SAC MYCHAL!', type: ActivityType.Watching },
        { name: 'moderátorskou challenge!', type: ActivityType.Playing }
    ];
    setInterval(() => {
        const status = statuses[Math.floor(Math.random() * statuses.length)];
        client.user.setActivity(status.name, { type: status.type });
    }, 60000);

    try {
        console.log('[COMMANDS] Začínám registraci aplikačních (/) příkazů pro server.');
        console.log("--------------------------");
        const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
        const commands = [
            new SlashCommandBuilder().setName('chat').setDescription('Pošle zprávu AI.').addStringOption(option => option.setName('zpráva').setDescription('Text pro AI.').setRequired(true)).setDMPermission(false),
            new SlashCommandBuilder().setName('score').setDescription('Zobrazí tvé hodnocení nebo hodnocení jiného uživatele.').addUserOption(option => option.setName('uživatel').setDescription('Uživatel, jehož skóre chceš vidět.').setRequired(false)).setDMPermission(false),
            new SlashCommandBuilder().setName('scoreboard').setDescription('Zobrazí síň slávy - žebříček všech uživatelů.').setDMPermission(false),
            new SlashCommandBuilder().setName('svatek').setDescription('Zobrazí, kdo má dnes svátek v Česku a na Slovensku.').setDMPermission(false),
            new SlashCommandBuilder().setName('rate').setDescription('Ohodnotí uživatele (pouze pro majitele).').addUserOption(option => option.setName('uživatel').setDescription('Uživatel, kterého chceš ohodnotit.').setRequired(true)).addNumberOption(option => option.setName('hodnocení').setDescription('Číslo od 0 do 10.').setRequired(true).setMinValue(0).setMaxValue(10)).setDMPermission(false),
            new SlashCommandBuilder().setName('resetscoreboard').setDescription('Smaže všechna data hodnocení (pouze pro majitele).').setDMPermission(false),
            new SlashCommandBuilder().setName('list-servers').setDescription('Vypíše seznam serverů, kde se bot nachází (pouze pro majitele).').setDMPermission(false),
            new SlashCommandBuilder().setName('leave-server').setDescription('Přinutí bota opustit server podle ID (pouze pro majitele).').addStringOption(option => option.setName('id').setDescription('ID serveru, který má bot opustit.').setRequired(true)).setDMPermission(false),
            new SlashCommandBuilder().setName('profil').setDescription('Zobrazí pěknou profilovou kartičku uživatele.').addUserOption(option => option.setName('uživatel').setDescription('Uživatel, jehož profil chceš vidět.').setRequired(false)).setDMPermission(false),
            new SlashCommandBuilder().setName('benchmark').setDescription('Spustí zátěžový test procesoru (pouze pro majitele).').addIntegerOption(option => option.setName('doba').setDescription('Délka testu v sekundách (výchozí: 10, max: 60).').setRequired(false)).setDMPermission(false),
        ].map(command => command.toJSON());
        const clientId = process.env.CLIENT_ID;
        const guildId = process.env.GUILD_ID;
        if (!clientId || !guildId) { throw new Error("[FATAL ERROR] CLIENT_ID nebo GUILD_ID není nastaveno v .env souboru!"); }
        
        Routes.applicationGuildCommands(clientId, guildId), { body: [] }
        Routes.applicationCommands(clientId), { body: commands }

        console.log('[COMMANDS] Úspěšně registrovány příkazy.');
        console.log("--------------------------");
    } catch (error) { console.error('[COMMANDS ERROR] Chyba při registraci (/) příkazů:', error); console.log("--------------------------"); }
    try {
        const channel = await client.channels.fetch(startupChannelId);
        if (channel) {
            const startupEmbed = new EmbedBuilder().setColor('#00FF00').setTitle('🚀 JSEM ZPÁTKY ONLINE! 🚀').setDescription('Jsem připraven hodnotit chování! 👀').setImage('https://tenor.com/view/robot-ai-artificial-intelligence-hello-waving-gif-14586208').setTimestamp().setFooter({ text: 'mychalVidea' });
            await channel.send({ embeds: [startupEmbed] });
        }
    } catch (error) { console.error("[STARTUP LOG ERROR] Chyba při odesílání startup zprávy:", error); console.log("--------------------------"); }
    console.log('[SERVER CHECK] Kontroluji servery...');
    console.log("--------------------------");
    client.guilds.cache.forEach(guild => { if (guild.id !== allowedGuildId) { console.log(`[LEAVE] Opouštím nepovolený server: ${guild.name} (ID: ${guild.id})`); guild.leave().catch(err => console.error(`[LEAVE ERROR] Nepodařilo se opustit server ${guild.name}:`, err)); } });

    console.log('[CRON] Plánuji automatickou úlohu pro svátek...');
    console.log("--------------------------");
    
    cron.schedule('5 2 * * *', async () => {
        console.log('[CRON JOB] Spouštím automatickou úlohu pro svátek...');
        try {
            if (!svatekAutoChannelId || svatekAutoChannelId === 'ZDE_VLOZ_ID_KANALU') {
                console.error('[CRON ERROR] Není nastaven kanál pro automatické posílání svátků (svatekAutoChannelId). Úloha přeskočena.');
                console.log("--------------------------");
                return;
            }

            const channel = await client.channels.fetch(svatekAutoChannelId);
            if (!channel) {
                console.error(`[CRON ERROR] Kanál pro svátek s ID ${svatekAutoChannelId} nebyl nalezen.`);
                console.log("--------------------------");
                return;
            }

            const svatky = await getNamenstagInfo();
            if (!svatky) {
                console.error('[CRON ERROR] Nepodařilo se načíst informace o svátcích pro automatickou úlohu.');
                console.log("--------------------------");
                return;
            }

            const timeZone = 'Europe/Prague';
            const zonedDate = utcToZonedTime(new Date(), timeZone);
            const formattedDate = format(zonedDate, 'd. M. yyyy');

            const svatekEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle(`💐 Dnes je ${formattedDate} a svátek slaví: 🌹`)
                .addFields(
                    { name: '🇨🇿 Česko', value: `\`\`\`${svatky.cz}\`\`\``, inline: true },
                    { name: '🇸🇰 Slovensko', value: `\`\`\`${svatky.sk}\`\`\``, inline: true }
                )
                .setFooter({
                    text: 'Přejeme vše nejlepší!',
                    iconURL: client.user.displayAvatarURL()
                });

            await channel.send({ embeds: [svatekEmbed] });
            console.log(`[CRON SUCCESS] Automatický svátek úspěšně odeslán do kanálu ${channel.name}.`);
            console.log("--------------------------");

        } catch (err) {
            console.error('[CRON ERROR] Došlo k chybě při automatickém posílání svátku:', err);
            console.log("--------------------------");
        }
    }, {
        scheduled: true,
        timezone: "Europe/Prague"
    });
});

client.on('guildCreate', guild => { 
    if (guild.id !== allowedGuildId) { 
        console.log(`[JOIN/LEAVE] Byl jsem přidán na nepovolený server: ${guild.name} (ID: ${guild.id}). Okamžitě ho opouštím.`); 
        console.log("--------------------------");
        guild.leave().catch(err => console.error(`[LEAVE ERROR] Nepodařilo se opustit nově přidaný server ${guild.name}:`, err)); 
    } 
});

client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'K této akci nemáš oprávnění.', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const [action, , authorId] = interaction.customId.split('-');
        const logMessage = await interaction.channel.messages.fetch(interaction.message.id).catch(() => null);
        if (action === 'approve') {
            if (logMessage) { const embed = new EmbedBuilder(logMessage.embeds[0].data).setColor('#00FF00').setTitle('✅ Obrázek Schválen').setDescription(`Obrázek od <@${authorId}> schválen moderátorem <@${interaction.user.id}>.`).setFields([]); await logMessage.edit({ embeds: [embed], components: [] }); }
            return interaction.editReply({ content: 'Obrázek byl schválen.' });
        } else if (action === 'punish') {
            const memberToPunish = await interaction.guild.members.fetch(authorId).catch(() => null);
            updateRating(authorId, -2.5, 'Důvod: Nevhodný obrázek (manuálně)');
            await applyTimeout(memberToPunish, 60 * 1000, 'Nevhodný obrázek (manuálně)');
            if (logMessage && logMessage.embeds[0]?.fields[0]) {
                const messageUrl = logMessage.embeds[0].fields[0].value;
                const urlParts = messageUrl.match(/channels\/\d+\/(\d+)\/(\d+)/);
                if (urlParts) {
                    const [, channelId, messageId] = urlParts;
                    const channel = await client.channels.fetch(channelId).catch(() => null);
                    if (channel) { const messageToDelete = await channel.messages.fetch(messageId).catch(() => null); if (messageToDelete) await messageToDelete.delete().catch(err => console.error("[MOD BUTTON ERROR] Nepodařilo se smazat zprávu:", err)); }
                }
            }
            await updateRoleStatus(authorId, interaction.guild);
            if (logMessage) { const embed = new EmbedBuilder(logMessage.embeds[0].data).setColor('#FF0000').setTitle('❌ Obrázek Zamítnut').setDescription(`Uživatel <@${authorId}> potrestán moderátorem <@${interaction.user.id}>.\nHodnocení sníženo o **2.5**, timeout na **60 sekund**`).setFields([]); await logMessage.edit({ embeds: [embed], components: [] }); }
            return interaction.editReply({ content: `Uživatel byl potrestán.` });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;
    const ownerId = process.env.OWNER_ID;

    if (commandName === 'svatek') {
        const isBypassChannel = interaction.channel.id === svatekBypassChannelId;

        if (!isBypassChannel) {
            const now = Date.now();
            const cooldownMilliseconds = SVATEK_COOLDOWN_MINUTES * 60 * 1000;
            const timeSinceLastUse = now - lastSvatekTimestamp;

            if (timeSinceLastUse < cooldownMilliseconds) {
                const timeLeftSeconds = (cooldownMilliseconds - timeSinceLastUse) / 1000;
                return interaction.reply({
                    content: `Tento příkaz může být globálně použit jen jednou za ${SVATEK_COOLDOWN_MINUTES} minut. Zkus to zase za **${timeLeftSeconds.toFixed(0)} sekund**.`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        await interaction.deferReply();
        const svatky = await getNamenstagInfo();

        if (!svatky) {
            return interaction.editReply({ content: 'Bohužel se nepodařilo načíst informace o svátcích. Zkus to prosím později.' });
        }

        const timeZone = 'Europe/Prague';
        const zonedDate = utcToZonedTime(new Date(), timeZone);
        const formattedDate = format(zonedDate, 'd. M. yyyy');

        const svatekEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle(`💐 Dnes je ${formattedDate} 🌹`)
            .addFields(
                { name: '🇨🇿 Česká republika', value: `\`\`\`${svatky.cz}\`\`\``, inline: true },
                { name: '🇸🇰 Slovensko', value: `\`\`\`${svatky.sk}\`\`\``, inline: true }
            )
            .setFooter({
                text: 'Přejeme vše nejlepší!',
                iconURL: client.user.displayAvatarURL()
            });

        if (!isBypassChannel) {
            lastSvatekTimestamp = Date.now();
        }

        return interaction.editReply({ embeds: [svatekEmbed] });
    }

    if (commandName === 'benchmark') {
        if (interaction.user.id !== ownerId) {
            return interaction.reply({ content: 'Tento tajný příkaz může použít pouze můj stvořitel! 🤖', ephemeral: true });
        }

        const duration = interaction.options.getInteger('doba') || 10;
        if (duration > 60) {
            return interaction.reply({ content: 'Hele, klid. Maximální doba testu je 60 sekund, ať neupečeme i půdu.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        interaction.editReply({ content: `Rozjíždím motory! Spouštím zátěžový test procesoru na ${duration} sekund... 🔥 Sleduj Správce úloh!` });

        setTimeout(() => {
            const startTime = Date.now();
            let operations = 0;
            console.log(`[Benchmark] Spuštěn na ${duration} sekund.`);
            
            while (Date.now() - startTime < duration * 1000) {
                const hash = crypto.createHash('sha256');
                hash.update(Math.random().toString());
                hash.digest('hex');
                operations++;
            }
            
            const endTime = Date.now();
            const timeTaken = (endTime - startTime) / 1000;
            console.log(`[Benchmark] Dokončen. Provedeno ${operations.toLocaleString('cs-CZ')} operací.`);

            interaction.editReply({ content: `✅ Benchmark dokončen za ${timeTaken.toFixed(2)}s! Procesor provedl **${operations.toLocaleString('cs-CZ')}** hashovacích operací. Ani se nezapotil!` });
        }, 100);
    }

    if (commandName === 'chat') {
        const now = Date.now();
        const userCooldown = chatCooldowns.get(interaction.user.id);
        if (userCooldown) {
            const timeLeft = (userCooldown + CHAT_COOLDOWN_SECONDS * 1000 - now) / 1000;
            if (timeLeft > 0) {
                return interaction.reply({ content: `S AI můžeš chatovat znovu za **${timeLeft.toFixed(1)}s**.`, flags: MessageFlags.Ephemeral });
            }
        }
        chatCooldowns.set(interaction.user.id, now);
        const userMessageContent = interaction.options.getString('zpráva');

        const MAX_CHAT_LENGTH = 200;
        if (userMessageContent.length > MAX_CHAT_LENGTH) {
            return interaction.reply({ content: `Tvoje zpráva je příliš dlouhá! Maximální povolená délka je **${MAX_CHAT_LENGTH} znaků**.`, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply();
        
        const ACTIVITY_CHANNEL_ID = '875097279650992128';
        const MAX_HISTORY_MESSAGES = 40;
        
        let context = "";
        try {
            const channel = await client.channels.fetch(ACTIVITY_CHANNEL_ID);
            if (channel) {
                const messages = await channel.messages.fetch({ limit: MAX_HISTORY_MESSAGES });

                const structuredHistory = [];
                
                for (const message of messages.values()) {
                    const timestamp = format(message.createdAt, 'HH:mm:ss');
                    const cleanedContent = message.content.replace(/^> ?/gm, '').trim();

                    if (message.author.bot) continue; 
                    if (cleanedContent.startsWith(prefix) || otherBotPrefixes.some(p => cleanedContent.startsWith(p))) continue;

                    const contentToLog = cleanedContent.length > 50 ? cleanedContent.substring(0, 50) + '...' : cleanedContent;
                    const historyEntry = `[${timestamp}] ${message.author.username} napsal: "${contentToLog}"`;
                    
                    structuredHistory.unshift(historyEntry);
                }
                
                const queryTimestamp = format(new Date(), 'HH:mm:ss');
                const userQueryEntry = `[${queryTimestamp}] ${interaction.user.username} se zeptal(/chat): "${userMessageContent}"`; 

                structuredHistory.unshift(userQueryEntry);

                context = "--- ZDE JE KONTEXT Z POSLEDNÍCH ZPRÁV V KANÁLU #activity ---\n" + structuredHistory.join('\n') + "\n----------------------------------------------------------------------\n";
            }
        } catch (e) {
            console.error("[CHAT CONTEXT FETCH ERROR]", e);
        }
        
        const currentChatHistory = chatHistory.get(interaction.user.id) || [];
        const historyForAI = currentChatHistory.map(turn => ({ role: turn.role, parts: [{ text: turn.content }] }));

        const prompt = `Jsi humorný a pomocný AI moderátor na discord serveru streamera / youtubera "mychalVidea" (na discordu pod nickem "@mychalvidea" - jenom takhle žádná jina forma!), hrajeme tu Fortnite (většina), CS2 (csko), Minecraft (už moc ne), *občas* dáme Forzu Horizon (ještě zkousneme Roblox, ale Valorant a League of Legends nemame radi), kdyby se někdo ptal nebo zdálo se že chce poradit tak mu poraď, když ti napíše mychal musíš být upřímný, mychal má ve Fortnite support-a-creator (sac) kód "mychal", lidi tě nazývají "🍀 SAC MYCHAL 🍀" (tvuj oficiální nick) a dále máš přiložený nick každého uživatele tak si s tím pohraj klidně i pošťouchni. Příkazy které můžou členové zadat, kdyby se někdo ptal: "/chat - Pošle zprávu AI. /score - Zobrazí hodnocení chování (nebo hodnocení chování jiného uživatele). /scoreboard - Ukáže žebříček nejlépe hodnocených uživatelů. /svatek - Ukáže kdo má dneska svátek., /profil - vytvoří se profilová kartička, která shrnuje základní informace o uživateli na serveru" Tvým úkolem je bavit se s uživateli jako člověk (ale ty jako bot nemůžeš hrát hry, nebav se příliš o hrách). Žádný rasizmus a nenávistný projev a zkus omezit vyšší toxicitu (lehčí trash talk je povolen). Odpověz na následující zprávu stručně, vtipně a neformálně. Tvoje odpověď musí mít maximálně 70 slov. ${context} Uživatel "${interaction.user.username}" napsal: "${userMessageContent}" Ty:`;

        const model = useModel20 ? "gemini-2.0-flash" : "gemini-2.5-flash";
        useModel20 = !useModel20;

        try {
            const response = await ai.models.generateContent({
                model,
                contents: [...historyForAI, { role: "user", parts: [{ text: prompt }] }]
            });
            
            const aiResponseText = response.text || `AI selhala. (${model})`;
            
            const newTurn = { role: 'user', content: userMessageContent };
            const aiTurn = { role: 'model', content: aiResponseText };
            
            let newHistory = [...currentChatHistory, newTurn, aiTurn];
            
            if (newHistory.length > MAX_CHAT_TURNS * 2) {
                newHistory = newHistory.slice(newHistory.length - MAX_CHAT_TURNS * 2);
            }
            
            chatHistory.set(interaction.user.id, newHistory);
            
            console.log(`[AI CHAT] Model: ${model} | Od: ${interaction.user.username} | Napsal: "${userMessageContent}"`);
            console.log("--------------------------");

            const embed = new EmbedBuilder().setColor('#5865F2').setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() }).setDescription(userMessageContent);
            await interaction.editReply({ embeds: [embed] });
            
            await interaction.followUp({ content: aiResponseText }); 
        } catch (error) {
            console.error(`[AI ERROR] Chyba u ${model}:`, error.message);
            console.log("--------------------------");

            const fallbackModel = model === "gemini-2.0-flash" ? "gemini-2.5-flash" : "gemini-2.0-flash";
            try {
                const response = await ai.models.generateContent({
                    model: fallbackModel,
                    contents: [...historyForAI, { role: "user", parts: [{ text: prompt }] }]
                });
                const aiResponseText = response.text || `AI neposlala žádnou odpověď. (${fallbackModel})`;

                const newTurn = { role: 'user', content: userMessageContent };
                const aiTurn = { role: 'model', content: aiResponseText };
                
                let newHistory = [...currentChatHistory, newTurn, aiTurn];
                
                if (newHistory.length > MAX_CHAT_TURNS * 2) {
                    newHistory = newHistory.slice(newHistory.length - MAX_CHAT_TURNS * 2);
                }
                
                chatHistory.set(interaction.user.id, newHistory);

                const embed = new EmbedBuilder().setColor('#5865F2').setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() }).setDescription(userMessageContent);
                await interaction.editReply({ embeds: [embed] });
                await interaction.followUp({ content: aiResponseText });

            } catch (err) {
                if (err.status === 429) {
                    const embed = new EmbedBuilder().setColor('#5865F2').setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() }).setDescription(userMessageContent);
                    await interaction.editReply({ embeds: [embed] });
                    return interaction.followUp("Vyčerpal jsi dnešní free limit pro AI. Zkus to zase zítra 🍀");
                }
                const embed = new EmbedBuilder().setColor('#5865F2').setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() }).setDescription(userMessageContent);
                await interaction.editReply({ embeds: [embed] });
                return interaction.followUp("Něco se pokazilo a AI nemůže odpovědět.");
            }
        }
    }
    
    if (commandName === 'list-servers' || commandName === 'leave-server') {
        if (interaction.user.id !== ownerId) { return interaction.reply({ content: 'Tento příkaz může použít pouze majitel bota.', flags: MessageFlags.Ephemeral }); }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (commandName === 'list-servers') { const guilds = client.guilds.cache.map(guild => `${guild.name} (ID: ${guild.id})`).join('\n'); const content = `Bot je na ${client.guilds.cache.size} serverech:\n\n${guilds}`; if (content.length > 2000) { const buffer = Buffer.from(content, 'utf-8'); return interaction.editReply({ files: [{ attachment: buffer, name: 'server-list.txt' }] }); } return interaction.editReply({ content }); }
        if (commandName === 'leave-server') { const guildId = interaction.options.getString('id'); const guild = client.guilds.cache.get(guildId); if (!guild) { return interaction.editReply({ content: `Chyba: Bot není na serveru s ID \`${guildId}\`.` }); } try { await guild.leave(); return interaction.editReply({ content: `✅ Úspěšně jsem opustil server **${guild.name}**.` }); } catch (err) { return interaction.editReply({ content: `❌ Nepodařilo se opustit server. Důvod: ${err.message}` }); } }
    }

    if (commandName === 'resetscoreboard') {
        if (!interaction.member.roles.cache.has(ownerRoleId)) { return interaction.reply({ content: 'K tomuto příkazu má přístup pouze majitel serveru.', flags: MessageFlags.Ephemeral }); }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        ratings = {};
        messageCounts = {};
        chatHistory.clear();
        saveRatings();
        saveMessageCounts();
        console.log("[SCOREBOARD] Data hodnocení a zpráv byla smazána majitelem.");
        console.log("--------------------------");
        return interaction.editReply({ content: '✅ Data hodnocení, počtu zpráv a historie chatu byla smazána.' });
    }

    if (commandName === 'score') {
        const targetUser = interaction.options.getUser('uživatel') || interaction.user;
        const isSelfCheck = targetUser.id === interaction.user.id;
        await interaction.deferReply({ ephemeral: isSelfCheck });
        const userRating = getUserRating(targetUser.id);
        const scoreMsg = isSelfCheck ? `🌟 Tvé hodnocení je: **\`${userRating.toFixed(2)} / 10\`**` : `🌟 Hodnocení <@${targetUser.id}> je: **\`${userRating.toFixed(2)} / 10\`**`;
        await interaction.editReply({ content: scoreMsg });
    }
    if (commandName === 'scoreboard') {
    await interaction.deferReply();

    const allUserIds = Object.keys(ratings);
    if (allUserIds.length === 0) {
        return interaction.editReply({ content: 'Síň slávy je prázdná!' });
    }

    // Krok 1: Vytvoříme seznam pouze pro členy, kteří jsou na serveru
    const membersWithScores = [];
    for (const userId of allUserIds) {
        // Zkusíme najít člena na serveru (bezpečně, s odchycením chyby)
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (member) {
            // Pokud člen existuje, přidáme ho do seznamu pro seřazení
            membersWithScores.push({
                id: userId,
                score: getUserRating(userId),
                member: member // Uložíme si celý objekt člena pro pozdější použití
            });
        }
    }

    if (membersWithScores.length === 0) {
        return interaction.editReply({ content: 'V síni slávy nejsou žádní aktuální členové serveru.' });
    }

    // Krok 2: Seřadíme POUZE aktivní členy podle jejich skóre
    membersWithScores.sort((a, b) => b.score - a.score);

    // Krok 3: Vezmeme prvních 10 a sestavíme z nich žebříček
    const top10 = membersWithScores.slice(0, 10);

    const scoreEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('✨🏆 SÍŇ SLÁVY 🏆✨')
        .setDescription('Udržuj si skóre nad **9.0** a získáš přístup do 👑 | VIP kanálu!\n\n')
        .setTimestamp()
        .setFooter({ text: 'Tvoje chování ovlivňuje tvé skóre.' });

    let leaderboardString = '';
        for (let i = 0; i < top10.length; i++) {
            const user = top10[i];
            const rank = i + 1;
            
            let rankDisplay = `**${rank}.**`;
            if (rank === 1) rankDisplay = '🥇';
            else if (rank === 2) rankDisplay = '🥈';
            else if (rank === 3) rankDisplay = '🥉';
            
            // Zkontrolujeme, zda má člen VIP roli
            const hasRole = user.member.roles.cache.has(roleId);
            const roleIndicator = hasRole ? ' 👑' : '';
            
            leaderboardString += `${rankDisplay} <@${user.id}> ⮞ \` ${user.score.toFixed(2)} / 10 \` ${roleIndicator}\n`;
        }
    
        if (leaderboardString === '') {
            // Toto by se už nemělo stát, ale pro jistotu
            return interaction.editReply({ content: 'V síni slávy zatím nikdo není.' });
        }
    
        scoreEmbed.setDescription(scoreEmbed.data.description + leaderboardString);
        await interaction.editReply({ embeds: [scoreEmbed] });
    }

    if (commandName === 'rate') {
        if (!interaction.member.roles.cache.has(ownerRoleId)) { return interaction.reply({ content: 'K tomuto příkazu má přístup pouze majitel serveru.', flags: MessageFlags.Ephemeral }); }
        await interaction.deferReply();
        const user = interaction.options.getUser('uživatel');
        const ratingInput = interaction.options.getNumber('hodnocení');
        if (user.id === interaction.user.id) { return interaction.editReply({ content: 'Snažíš se ohodnotit sám sebe? Hezký pokus. 😂'}); }
        if (user.bot) { return interaction.editReply({ content: 'Boti se nehodnotí.'}); }
        const currentRating = getUserRating(user.id);
        let newRating = (currentRating + ratingInput) / 2;
        newRating = Math.max(0, Math.min(10, newRating));
        ratings[user.id] = newRating;
        saveRatings();
        console.log(`[ADMIN RATE] Uživatel ${user.tag} (${user.id}) byl ohodnocen adminem ${interaction.user.tag}. Nové skóre: ${newRating}.`);
        console.log("--------------------------");
        await updateRoleStatus(user.id, interaction.guild);
        await interaction.editReply({ content: `**<@${user.id}>** obdržel(a) nové hodnocení! 🔥 Nové skóre: **\`${newRating.toFixed(2)} / 10\`**` });
    }

    if (commandName === 'profil') {
        try {
            console.log(`[COMMAND] Příkaz /profil použit uživatelem: ${interaction.user.tag}`);
            console.log("--------------------------");
        
            await interaction.deferReply();
        
            const targetUser = interaction.options.getUser('uživatel') || interaction.user;
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null); // Přidán .catch pro jistotu
        
            if (!member) {
                return interaction.editReply({ content: 'Uživatel nebyl na tomto serveru nalezen.', ephemeral: true });
            }
        
            const canvas = Canvas.createCanvas(800, 400);
            const ctx = canvas.getContext('2d');
        
            const background = await Canvas.loadImage('./assets/background.png');
            ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 4;
            ctx.strokeRect(0, 0, canvas.width, canvas.height);
        
            ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
            ctx.shadowBlur = 15;
            ctx.shadowOffsetX = 5;
            ctx.shadowOffsetY = 5;
        
            ctx.beginPath();
            ctx.arc(125, 125, 80, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.fillStyle = '#000';
            ctx.fill();
        
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        
            ctx.save();
            ctx.clip();
            const avatar = await Canvas.loadImage(member.displayAvatarURL({ extension: 'png', size: 256 }));
            ctx.drawImage(avatar, 45, 45, 160, 160);
            ctx.restore();
        
            ctx.strokeStyle = '#5865F2';
            ctx.lineWidth = 6;
            ctx.stroke();
        
            ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
            ctx.shadowBlur = 5;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
        
            let mainText = member.nickname || member.user.username;

            ctx.font = '48px "Quicksand"';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(mainText, 240, 90);
        
            ctx.font = '22px "Quicksand"';
            const joinDate = member.joinedAt.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
            ctx.fillText(`Na serveru od: ${joinDate}`, 240, 145); 

            const userRating = getUserRating(member.id);
            ctx.fillText(`Skóre chování: ${userRating.toFixed(2)} / 10`, 240, 175); 

            // === OPRAVENÁ A ZRYCHLENÁ ČÁST PRO ZJIŠTĚNÍ POZICE ===
            const userIds = Object.keys(ratings);
            // NENÍ TŘEBA NIC STAHOVAT! Jen seřadíme ID podle skóre.
            userIds.sort((a, b) => getUserRating(b) - getUserRating(a));

            const targetUserId = member.id;
            let scoreboardRank = userIds.findIndex(id => id === targetUserId);

            let rankDisplay;
            if (scoreboardRank === -1) {
                rankDisplay = "Není v žebříčku";
            } else {
                const rankNumber = scoreboardRank + 1;
                rankDisplay = rankNumber === 1 ? '🥇 1.' : rankNumber === 2 ? '🥈 2.' : rankNumber === 3 ? '🥉 3.' : `#${rankNumber}.`;
            }
            // =====================================================

            ctx.fillText(`Pozice v žebříčku: ${rankDisplay}`, 240, 205);

            ctx.shadowColor = 'transparent';
        
            ctx.font = '24px "Quicksand"';
            ctx.fillStyle = '#ffffff';
            ctx.fillText('Role:', 240, 245);

            const rolesStartX = 240;
            const rolesStartY = 280;
            const padding = 10;
            const lineHeight = 45;
            const rightMargin = 20;
            const maxRolesToShow = 6;

            let currentX = rolesStartX;
            let currentY = rolesStartY;
        
            const roles = member.roles.cache
                .filter(role => role.name !== '@everyone' && role.color !== 0)
                .sort((a, b) => b.position - a.position)
                .map(role => ({ name: role.name, color: role.hexColor }));

            for (let i = 0; i < roles.slice(0, maxRolesToShow).length; i++) {
                const role = roles[i];

                ctx.font = '18px "Quicksand"';
                const roleWidth = ctx.measureText(role.name).width + 20;
            
                if (currentX + roleWidth > canvas.width - rightMargin) {
                    currentX = rolesStartX;
                    currentY += lineHeight;
                }
            
                ctx.fillStyle = role.color;
                ctx.beginPath();
                ctx.roundRect(currentX, currentY - 20, roleWidth, 30, [15]);
                ctx.fill();
            
                ctx.fillStyle = '#ffffff';
                ctx.fillText(role.name, currentX + 10, currentY);
            
                currentX += roleWidth + padding;
            }
        
            const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'profil-karta-final.png' });
            await interaction.editReply({ files: [attachment] });
        
        } catch (error) {
            console.error("[PROFIL ERROR] Chyba při generování profilové karty:", error);
            console.log("--------------------------");
            try {
                if (!interaction.replied) {
                    await interaction.editReply({ content: 'Omlouvám se, nepodařilo se mi vygenerovat profilovou kartu.', ephemeral: true });
                }
            } catch (e) {
                console.error("[PROFIL ERROR] Nepodařilo se odeslat chybovou zprávu:", e);
            }
        }
    }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (newMember.roles.cache.has(ownerRoleId)) return;
});

client.on('guildBanAdd', async (ban) => { 
    ratings[ban.user.id] = 0.0; 
    saveRatings(); 
    await updateRoleStatus(ban.user.id, ban.guild, null); 
    try { 
        const channel = await client.channels.fetch(logChannelId); 
        if (channel) channel.send(`[BAN ALERT] Uživatel **${ban.user.tag}** dostal BAN, hodnocení resetováno na **0**!`); 
        console.log(`[BAN] Uživatel ${ban.user.tag} zabanován, rating resetován na 0.`);
        console.log("--------------------------");
    } catch (err) { console.error("[BAN ERROR] Chyba při logování banu:", err); console.log("--------------------------"); }
});

client.on('messageCreate', async message => {
        if (message.channel.id === countingChannelId) {
        // Ignorujeme zprávy, které nejsou čísla (např. pokud někdo napíše "lol")
        if (isNaN(parseInt(message.content))) {
            // Můžeme smazat zprávu, aby to nerušilo, ale není to nutné
            // if (message.deletable) message.delete().catch(() => {});
            return;
        }
    
        const number = parseInt(message.content, 10);
        let errorReason = '';
    
        // Kontrola pravidel
        if (number !== countingState.currentCount + 1) {
            errorReason = `špatné číslo! Po **${countingState.currentCount}** mělo přijít **${countingState.currentCount + 1}**.`;
        } else if (message.author.id === countingState.lastUser) {
            errorReason = 'nesmíš počítat dvakrát za sebou!';
        }
    
        // Pokud došlo k chybě
        if (errorReason) {
            // Potrestáme uživatele
            updateRating(message.author, -2, "Důvod: Pokazil počítání");
            await updateRoleStatus(message.author.id, message.guild, message);
            
            // Oznámíme chybu a reset
            message.reply(`**ŠPATNĚ!** <@${message.author.id}> pokazil počítání, protože napsal ${errorReason}\nŘada byla přerušena na čísle **${countingState.currentCount}**. Počítání se resetuje od **1**.`);
            message.react('❌').catch(() => {});
        
            // Resetujeme stav
            countingState.currentCount = 0;
            countingState.lastUser = null;
            saveCountingState(countingState);
            return;
        }
    
        // Pokud je vše v pořádku (úspěšná cesta)
        countingState.currentCount = number;
        countingState.lastUser = message.author.id;
        saveCountingState(countingState);
    
        // Přidáme reakce
        message.react('✅').catch(() => {});
        if (number % 1000 === 0) message.react('🏆').catch(() => {});
        else if (number % 100 === 0) message.react('💯').catch(() => {});
        else if (number % 50 === 0) message.react('🎉').catch(() => {});
    }
    if (message.author.bot || !message.guild) return;
    if (otherBotPrefixes.some(p => message.content.startsWith(p)) || message.content.startsWith(prefix)) return;
    if (await checkRepetitiveSpam(message)) return;
    if (message.author.id === process.env.OWNER_ID) return;
    const wasModerated = await moderateMessage(message);
    if (!wasModerated && message.channel.id === activityChannelId) {
        messageCounts[message.author.id] = (messageCounts[message.author.id] || 0) + 1;
        if (messageCounts[message.author.id] >= 10) {
            updateRating(message.author, 0.2, "Důvod: Aktivita");
            await updateRoleStatus(message.author.id, message.guild, message);
            messageCounts[message.author.id] = 0;
        }
        saveMessageCounts();
    }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (newMessage.partial) { try { await newMessage.fetch(); } catch { return; } }
    if (newMessage.author.bot || !newMessage.guild || oldMessage.content === newMessage.content) return;
    if (newMessage.author.id === process.env.OWNER_ID) return;
    await moderateMessage(newMessage);
});

client.login(process.env.BOT_TOKEN);
