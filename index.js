require('dotenv').config();

// PŘIDÁNY POTŘEBNÉ VĚCI PRO SLASH PŘÍKAZY
const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
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
const prefix = 'm!'; // Prefix zůstává pro případné budoucí využití, ale příkazy budou /
const roleId = process.env.ROLE_ID;
const geminiApiKey = process.env.GEMINI_API_KEY;
const tenorApiKey = process.env.TENOR_API_KEY; // <-- PŘIDÁNO PRO TENOR
const errorGif = 'https://tenor.com/view/womp-womp-gif-9875106689398845891';
const ownerRoleId = '875091178322812988';
const activityChannelId = '875097279650992128';
const startupChannelId = '1005985776158388264';
const logChannelId = '1025689879973203968';
const aiModerationChannelIds = ['875097279650992128', '1261094481415897128', '1275999194313785415', '1322337083745898616', '1419340737048350880'];
const MAX_WORDS_FOR_AI = 50;
const MIN_CHARS_FOR_AI = 4;
const COOLDOWN_SECONDS = 5;
const NOTIFICATION_COOLDOWN_MINUTES = 10;
const otherBotPrefixes = ['?', '!', 'db!', 'c!', '*'];
const emojiSpamRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|<a?:\w+:\d+>){10,}/;
const mediaUrlRegex = /https?:\/\/(media\.tenor\.com|tenor\.com|giphy\.com|i\.imgur\.com|cdn\.discordapp\.com|img\.youtube\.com)\S+(?:\.gif|\.png|\.jpg|\.jpeg|\.webp|\.mp4)/i;
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;

// Modely pro textovou moderaci
let activeTextModel = 'gemini-2.5-flash-lite';
const fallbackTextModel = 'gemini-1.5-flash-latest';
let hasSwitchedTextFallback = false;

// Modely pro obrázkovou moderaci
const activeImageModel = 'gemini-2.5-pro';
const firstFallbackImageModel = 'gemini-1.5-pro-latest';
const secondFallbackImageModel = 'gemini-2.5-flash';
let hasSwitchedToFirstFallback = false;
let hasSwitchedToSecondFallback = false;

const level3Words = [ 'nigga', 'n1gga', 'n*gga', 'niggas', 'nigger', 'n1gger', 'n*gger', 'niggers', 'niga', 'n1ga', 'nygga', 'niggar', 'negr', 'ne*r', 'n*gr', 'n3gr', 'neger', 'negri', 'neger' ];
const level2Words = [ 'kundo', 'kundy', 'píčo', 'pico', 'pičo', 'čuráku', 'curaku', 'čůráku', 'píčus', 'picus', 'zmrd', 'zmrde', 'mrdko', 'buzerant', 'buzna', 'kurva', 'kurvo', 'kurvy', 'čurák', 'curak', 'šukat', 'mrdat', 'bitch', 'b*tch', 'whore', 'slut', 'faggot', 'motherfucker', 'asshole', 'assh*le', 'bastard', 'cunt', 'c*nt', 'dickhead', 'dick', 'pussy', 'fuck', 'f*ck', 'fck', 'kys', 'kill yourself', 'go kill yourself', 'zabij se', 'fuk', 'hitler' ];
const level1Words = [ 'kretén', 'sračka', 'píčo', 'pičo', 'fakin', 'curak', 'píča', 'zkurvysyn', 'dopíči', 'dokundy'];

const level3Regex = new RegExp(`\\b(${level3Words.join('|')})\\b`, 'i');
const level2Regex = new RegExp(`\\b(${level2Words.join('|')})\\b`, 'i');
const level1Regex = new RegExp(`\\b(${level1Words.join('|')})\\b`, 'i');

const userCooldowns = new Map();
let lastLimitNotificationTimestamp = 0;

const dataDirectory = './data';
const ratingsFilePath = `${dataDirectory}/ratings.json`;
const messageCountsFilePath = `${dataDirectory}/message_counts.json`;

if (!fs.existsSync(dataDirectory)) fs.mkdirSync(dataDirectory);
let ratings = {};
try { ratings = JSON.parse(fs.readFileSync(ratingsFilePath, 'utf8')); } catch (err) {}
let messageCounts = {};
try { messageCounts = JSON.parse(fs.readFileSync(messageCountsFilePath, 'utf8')); } catch (err) {}

function saveRatings() { try { fs.writeFileSync(ratingsFilePath, JSON.stringify(ratings, null, 2)); } catch (err) {} }
function saveMessageCounts() { try { fs.writeFileSync(messageCountsFilePath, JSON.stringify(messageCounts, null, 2)); } catch (err) {} }
function calculateAverage(userId) { const userRatings = ratings[userId] || []; if (userRatings.length === 0) return 5.0; let average = userRatings.reduce((a, b) => a + b, 0) / userRatings.length; return Math.max(0, Math.min(10, average));}
async function updateRoleStatus(userId, guild, sourceMessage = null) { try { if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return; const member = await guild.members.fetch(userId).catch(() => null); const role = guild.roles.cache.get(roleId); if (!member || !role) return; const averageRating = calculateAverage(userId); const hasRole = member.roles.cache.has(roleId); if (averageRating > 9 && !hasRole) { await member.roles.add(role); const messageContent = `🎉 Gratulace, <@${member.id}>! Tvé skóre tě katapultovalo mezi elitu a získal(a) jsi roli **${role.name}**! 🚀`; if (sourceMessage && sourceMessage.channel && !sourceMessage.deleted) { sourceMessage.reply(messageContent).catch(() => {}); } else { const channel = await client.channels.fetch(logChannelId).catch(() => null); if (channel) channel.send(messageContent).catch(() => {}); } } else if (averageRating <= 9 && hasRole) { await member.roles.remove(role); const messageContent = `📉 Pozor, <@${member.id}>! Tvé hodnocení kleslo a přišel(a) jsi o roli **${role.name}**. Zaber!`; if (sourceMessage && sourceMessage.channel && !sourceMessage.deleted) { sourceMessage.reply(messageContent).catch(() => {}); } else { const channel = await client.channels.fetch(logChannelId).catch(() => null); if (channel) channel.send(messageContent).catch(() => {}); } } } catch (error) {} }
function addRating(userId, rating, reason = "") { if (!ratings[userId]) ratings[userId] = []; ratings[userId].push(rating); if (ratings[userId].length > 10) ratings[userId].shift(); saveRatings(); console.log(`Uživatel ${userId} dostal hodnocení ${rating}. ${reason}`);}
function cleanupOldRatings() { let changed = false; for (const userId in ratings) { if (ratings[userId].length > 10) { ratings[userId] = ratings[userId].slice(-10); changed = true; } } if (changed) saveRatings(); }
cleanupOldRatings();

async function analyzeText(text) {
    if (!geminiApiKey) return false;
    const prompt = `Jsi AI moderátor pro neformální, herní Discord server. Tvým úkolem je odhalit zprávy, které jsou škodlivé. Ignoruj běžné lehké nadávky a přátelské pošťuchování. Zasáhni, pokud zpráva překročí hranici běžného "trash talku" a stane se z ní nenávistný projev, vyhrožování nebo šikana. Je tato zpráva taková? Odpověz jen "ANO" nebo "NE".\n\nText: "${text}"`;
    const requestBody = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 5 } };
    try {
        const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${activeTextModel}:generateContent?key=${geminiApiKey}`, requestBody);
        const candidateText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!candidateText) {
            console.log(`Gemini textová analýza (${activeTextModel}) byla zablokována bezpečnostním filtrem.`);
            return false;
        }
        return candidateText.trim().toUpperCase().includes("ANO");
    } catch (error) {
        const status = error.response ? error.response.status : null;
        if ((status === 429 || status === 404) && !hasSwitchedTextFallback) {
            console.warn(`Model ${activeTextModel} selhal (stav: ${status}). Přepínám na záložní model: ${fallbackTextModel}`);
            activeTextModel = fallbackTextModel;
            hasSwitchedTextFallback = true;
            try { const channel = await client.channels.fetch(logChannelId); if (channel) channel.send(`🟡 **VAROVÁNÍ:** Primární AI model pro text selhal. Automaticky přepínám na záložní model.`); } catch (err) {}
            return analyzeText(text);
        }
        if (status === 429) { return 'API_LIMIT'; }
        console.error(`Chyba při komunikaci s Gemini API (${activeTextModel}):`, error.response ? error.response.data.error : error.message);
        return false;
    }
}

// ================== PŘIDANÁ FUNKCE PRO TENOR API ==================
async function getDirectTenorUrl(tenorUrl) {
    if (!tenorApiKey) {
        console.warn("TENOR_API_KEY není nastaven. Moderace Tenor GIFů nemusí být spolehlivá.");
        return tenorUrl;
    }
    // Vylepšený regex pro získání ID z různých typů Tenor URL
    const gifIdMatch = tenorUrl.match(/\/view\/.*-(\d+)$/) || tenorUrl.match(/\/(\d+)$/);
    if (!gifIdMatch) return tenorUrl;

    const gifId = gifIdMatch[1];
    try {
        const apiUrl = `https://tenor.googleapis.com/v2/posts?ids=${gifId}&key=${tenorApiKey}&media_filter=mediumgif`;
        const response = await axios.get(apiUrl);
        return response.data?.results[0]?.media_formats?.mediumgif?.url || tenorUrl;
    } catch (error) {
        console.error(`Chyba při získávání GIFu z Tenor API pro ID ${gifId}:`, error.message);
        return tenorUrl;
    }
}

async function analyzeImage(imageUrl) {
    if (!geminiApiKey) return false;
    const modelsToTry = [activeImageModel, firstFallbackImageModel, secondFallbackImageModel];
    let lastError = null, imageBuffer, mimeType;
    try {
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        imageBuffer = response.data;
        mimeType = response.headers['content-type'];

        if (!mimeType) {
            console.error(`Chyba: Z URL ${imageUrl} se nepodařilo získat content-type.`);
            return 'FILTERED';
        }
        if (mimeType.startsWith('image/gif')) {
            const frames = await getFrames({ url: imageBuffer, frames: 'all', outputType: 'png', quality: 10 });
            if (frames.length === 0) return false;
            const middleFrameIndex = Math.floor(frames.length / 2);
            imageBuffer = await new Promise((resolve, reject) => {
                const stream = frames[middleFrameIndex].getImage();
                const chunks = [];
                stream.on('data', chunk => chunks.push(chunk));
                stream.on('error', reject);
                stream.on('end', () => resolve(Buffer.concat(chunks)));
            });
            mimeType = 'image/png';
        } else if (mimeType.startsWith('image/')) {
            imageBuffer = await sharp(imageBuffer).resize({ width: 512, withoutEnlargement: true }).toBuffer();
        } else {
            return false;
        }
    } catch (preprocessingError) {
        console.error(`Chyba při předzpracování obrázku ${imageUrl}:`, preprocessingError.message);
        return 'FILTERED';
    }
    const base64Image = imageBuffer.toString('base64');
    const prompt = `Jsi AI moderátor pro herní Discord server. Posuď, jestli je tento obrázek skutečně nevhodný pro komunitu (pornografie, gore, explicitní násilí, nenávistné symboly, rasismus). Ignoruj herní násilí (střílení ve hrách), krev ve hrách, herní rozhraní (UI) a běžné internetové memy, které nejsou extrémní. Buď shovívavý k textu na screenshotech. Odpověz jen "ANO" (pokud je nevhodný) nebo "NE" (pokud je v pořádku).`;
    const requestBody = { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }] }] };
    for (const model of modelsToTry) {
        try {
            const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`, requestBody);
            if (!response.data.candidates || response.data.candidates.length === 0) {
                console.log(`Gemini obrázková analýza (${model}) byla zablokována bezpečnostním filtrem pro obrázek: ${imageUrl}`);
                return 'FILTERED';
            }
            const result = response.data.candidates[0].content.parts[0].text.trim().toUpperCase();
            return result.includes("ANO");
        } catch (error) {
            lastError = error;
            const status = error.response ? error.response.status : null;
            if (status === 429 || status === 404 || status === 500) {
                if (model === activeImageModel && !hasSwitchedToFirstFallback) {
                    console.warn(`Model ${model} selhal (stav: ${status}). Přepínám na první zálohu: ${firstFallbackImageModel}`);
                    hasSwitchedToFirstFallback = true;
                    try { const channel = await client.channels.fetch(logChannelId); if (channel) channel.send(`🟠 **VAROVÁNÍ:** Primární AI model pro obrázky selhal. Automaticky přepínám na první záložní model.`); } catch (err) {}
                } else if (model === firstFallbackImageModel && !hasSwitchedToSecondFallback) {
                    console.warn(`Model ${model} selhal (stav: ${status}). Přepínám na druhou (poslední) zálohu: ${secondFallbackImageModel}`);
                    hasSwitchedToSecondFallback = true;
                    try { const channel = await client.channels.fetch(logChannelId); if (channel) channel.send(`🔴 **KRITICKÉ VAROVÁNÍ:** Záložní AI model pro obrázky selhal. Přepínám na poslední záchrannou možnost (${secondFallbackImageModel}).`); } catch (err) {}
                }
            } else { break; }
        }
    }
    console.error(`Všechny AI modely pro analýzu obrázků selhaly pro ${imageUrl}. Poslední chyba: ${lastError.message}`);
    return 'FILTERED';
}

async function moderateMessage(message) {
    if (!message.guild || !message.author || message.author.bot) return false;
    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member || member.roles.cache.has(ownerRoleId)) return false;

    if (aiModerationChannelIds.includes(message.channel.id)) {
        let mediaUrl = null;

        // OPRAVA 1: Použití `proxyURL` pro přílohy, aby nevypršely
        if (message.attachments.size > 0) {
            const attachment = message.attachments.first();
            if (attachment.size < MAX_FILE_SIZE_BYTES && (attachment.contentType?.startsWith('image/'))) {
                mediaUrl = attachment.proxyURL;
            }
        }
        if (!mediaUrl && message.embeds.length > 0) {
            const embed = message.embeds[0];
            if (embed.image) mediaUrl = embed.image.url;
            else if (embed.thumbnail) mediaUrl = embed.thumbnail.url;
            else if (embed.url && (embed.type === 'image' || embed.type === 'gifv')) mediaUrl = embed.url;
        }
        if (!mediaUrl) {
            const match = message.content.match(mediaUrlRegex);
            if (match) mediaUrl = match[0];
        }

        if (mediaUrl) {
            let finalMediaUrl = mediaUrl;
            // OPRAVA 2: Zpracování Tenor odkazů přes API pro spolehlivost
            if (mediaUrl.includes('tenor.com')) {
                finalMediaUrl = await getDirectTenorUrl(mediaUrl);
            }
            
            const imageResult = await analyzeImage(finalMediaUrl);
            if (imageResult === true) {
                addRating(message.author.id, -2, `Důvod: Nevhodný obrázek/GIF (detekováno AI)`);
                await updateRoleStatus(message.author.id, message.guild, message);
                try {
                    await message.delete();
                    const warningMsg = await message.channel.send(`<@${message.author.id}>, tvůj obrázek/GIF byl vyhodnocen jako nevhodný a tvé hodnocení bylo sníženo.`);
                    setTimeout(() => warningMsg.delete().catch(() => {}), 15000);
                } catch (err) {}
                return true;
            } else if (imageResult === 'FILTERED') {
                const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
                if (logChannel) {
                    const embed = new EmbedBuilder().setColor('#FFA500').setTitle('⚠️ AI Moderace Selhala').setDescription(`AI nedokázala analyzovat obrázek od <@${message.author.id}>.\nŽádám o lidský posudek.`).setImage(finalMediaUrl).addFields({ name: 'Odkaz na zprávu', value: `[Klikni zde](${message.url})` }).setTimestamp();
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`approve-${message.id}-${message.author.id}`).setLabel('✅ Ponechat').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`punish-${message.id}-${message.author.id}`).setLabel('❌ Smazat a potrestat').setStyle(ButtonStyle.Danger)
                    );
                    await logChannel.send({ embeds: [embed], components: [row] });
                }
                return false;
            }
        }

        let textToAnalyze = message.content.replace(mediaUrlRegex, '').trim();
        if (textToAnalyze.length === 0 && message.embeds.length > 0) {
            const embed = message.embeds[0];
            textToAnalyze = [embed.title, embed.description, ...embed.fields.map(f => f.value)].filter(Boolean).join(' ');
        }
        if (textToAnalyze.length === 0) return false;

        if (emojiSpamRegex.test(textToAnalyze)) {
            try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, hoď se do klidu, tolik emoji není nutný! 😂`); setTimeout(() => warningMsg.delete().catch(() => {}), 10000); } catch (err) {}
            return true;
        }
        if (level3Regex.test(textToAnalyze)) {
            ratings[message.author.id] = [0]; saveRatings();
            await updateRoleStatus(message.author.id, message.guild, message);
            try { await message.delete(); const warningMsg = await message.channel.send(`Uživatel <@${message.author.id}> použil přísně zakázané slovo. Tvoje hodnocení bylo **resetováno na 0**!`); setTimeout(() => warningMsg.delete().catch(() => {}), 20000); } catch (err) {}
            return true;
        }
        if (level2Regex.test(textToAnalyze)) {
            addRating(message.author.id, -3, "Důvod: Hrubá urážka");
            await updateRoleStatus(message.author.id, message.guild, message);
            try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, za toto chování ti byl snížen rating o **3 body**.`); setTimeout(() => warningMsg.delete().catch(() => {}), 10000); } catch (err) {}
            return true;
        }
        if (level1Regex.test(textToAnalyze)) {
            addRating(message.author.id, -1, "Důvod: Nevhodné slovo");
            await updateRoleStatus(message.author.id, message.guild, message);
            try { const warningReply = await message.reply(`Slovník prosím. 🤫 Za tuto zprávu ti byl lehce snížen rating.`); setTimeout(() => warningReply.delete().catch(() => {}), 10000); } catch (err) {}
            return true;
        }
        const wordCount = textToAnalyze.split(' ').length;
        if (textToAnalyze.length >= MIN_CHARS_FOR_AI && wordCount <= MAX_WORDS_FOR_AI) {
            const now = Date.now();
            const lastCheck = userCooldowns.get(message.author.id);
            if (!lastCheck || (now - lastCheck > COOLDOWN_SECONDS * 1000)) {
                userCooldowns.set(message.author.id, now);
                const toxicityResult = await analyzeText(textToAnalyze);
                if (toxicityResult === true) {
                    addRating(message.author.id, -2, `Důvod: Toxická zpráva (detekováno AI)`);
                    await updateRoleStatus(message.author.id, message.guild, message);
                    try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, tvá zpráva byla nevhodná a tvé hodnocení bylo sníženo.`); setTimeout(() => warningMsg.delete().catch(() => {}), 15000); } catch (err) {}
                    return true;
                } else if (toxicityResult === 'API_LIMIT') {
                    if (now - lastLimitNotificationTimestamp > NOTIFICATION_COOLDOWN_MINUTES * 60 * 1000) {
                        lastLimitNotificationTimestamp = now;
                        try { const reply = await message.reply(`AI nemohla tuto zprávu ověřit, protože si dala šlofíka na pár hodin!`); setTimeout(() => reply.delete().catch(() => {}), 300000); } catch(err) {}
                    }
                }
            }
        }
    }
    return false;
}

// ================== PŘIDÁNA REGISTRACE SLASH PŘÍKAZŮ ==================
client.once('clientReady', async () => {
    console.log(`Bot je online jako ${client.user.tag}!`);
    
    // Registrace příkazů
    try {
        console.log('Započato obnovování aplikačních (/) příkazů.');
        const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
        
        const commands = [
            new SlashCommandBuilder()
                .setName('score')
                .setDescription('Zobrazí tvé hodnocení nebo hodnocení jiného uživatele.')
                .addUserOption(option => option.setName('uživatel').setDescription('Uživatel, jehož skóre chceš vidět.')),
            new SlashCommandBuilder()
                .setName('scoreboard')
                .setDescription('Zobrazí síň slávy - žebříček všech uživatelů.'),
            new SlashCommandBuilder()
                .setName('rate')
                .setDescription('Ohodnotí uživatele (pouze pro adminy).')
                .addUserOption(option => option.setName('uživatel').setDescription('Uživatel, kterého chceš ohodnotit.').setRequired(true))
                .addNumberOption(option => option.setName('hodnocení').setDescription('Číslo od -10 do 10.').setRequired(true))
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        ].map(command => command.toJSON());

        const clientId = process.env.CLIENT_ID;
        const guildId = process.env.GUILD_ID;
        if (!clientId || !guildId) throw new Error("CLIENT_ID nebo GUILD_ID chybí v .env souboru!");

        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
        console.log('Úspěšně obnoveny aplikační příkazy.');
    } catch (error) {
        console.error('Chyba při registraci (/) příkazů:', error);
    }
    
    // Zpráva o spuštění
    try {
        const channel = await client.channels.fetch(startupChannelId);
        if (channel) {
            const startupEmbed = new EmbedBuilder().setColor('#00FF00').setTitle('🚀 JSEM ZPÁTKY ONLINE! 🚀').setDescription('Systémy nastartovány, databáze pročištěna. Jsem připraven hodnotit vaše chování! 👀').setImage('https://tenor.com/view/robot-ai-artificial-intelligence-hello-waving-gif-14586208').setTimestamp().setFooter({ text: 'mychalVidea' });
            await channel.send({ embeds: [startupEmbed] });
        }
    } catch (error) {}
});

// ================== PŘIDÁNA/UPRAVENA LOGIKA PRO INTERAKCE ==================
client.on('interactionCreate', async interaction => {
    // Zpracování tlačítek (zůstalo stejné)
    if (interaction.isButton()) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'K této akci nemáš oprávnění.', ephemeral: true });
        }
        const [action, , authorId] = interaction.customId.split('-');
        try {
            const originalMessageUrl = interaction.message.embeds[0].fields[0].value;
            const urlParts = originalMessageUrl.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
            if (!urlParts) throw new Error("Nelze najít původní zprávu z URL.");
            const [, , channelId, messageId] = urlParts;
            const channel = await client.channels.fetch(channelId);
            if (!channel) throw new Error("Původní kanál nenalezen.");
            const messageToModerate = await channel.messages.fetch(messageId).catch(() => null);
            if (action === 'approve') {
                const approvedEmbed = new EmbedBuilder(interaction.message.embeds[0].toJSON())
                    .setColor('#00FF00').setTitle('✅ Schváleno Moderátorem')
                    .setDescription(`Obrázek od <@${authorId}> byl ponechán.\nSchválil: <@${interaction.user.id}>`);
                await interaction.update({ embeds: [approvedEmbed], components: [] });
            } else if (action === 'punish') {
                addRating(authorId, -2, `Důvod: Nevhodný obrázek (rozhodnutí moderátora)`);
                if (interaction.guild) {
                    await updateRoleStatus(authorId, interaction.guild);
                }
                if (messageToModerate) {
                    await messageToModerate.delete().catch(err => console.log("Nepodařilo se smazat zprávu."));
                    const warningMsg = await channel.send(`<@${authorId}>, tvůj obrázek/GIF byl vyhodnocen jako nevhodný a tvé hodnocení bylo sníženo.`);
                    setTimeout(() => warningMsg.delete().catch(() => {}), 15000);
                }
                const punishedEmbed = new EmbedBuilder(interaction.message.embeds[0].toJSON())
                    .setColor('#FF0000').setTitle('❌ Smazáno a Potrestáno Moderátorem')
                    .setDescription(`Obrázek od <@${authorId}> byl smazán a uživatel potrestán.\nModerátor: <@${interaction.user.id}>`);
                await interaction.update({ embeds: [punishedEmbed], components: [] });
            }
        } catch (error) {
            console.error("Chyba při zpracování interakce:", error);
            await interaction.reply({ content: 'Došlo k chybě. Zkus to prosím ručně.', ephemeral: true });
        }
        return;
    }

    // Zpracování slash příkazů
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'score') {
            const targetUser = interaction.options.getUser('uživatel') || interaction.user;
            const isSelfCheck = targetUser.id === interaction.user.id;
            
            const userRatings = ratings[targetUser.id] || [];
            if (userRatings.length === 0) {
                let errorMsg = isSelfCheck ? 'Zatím nemáš žádné hodnocení, kámo! 🤷' : `Uživatel ${targetUser.toString()} je zatím nepopsaný list. 📜`;
                return interaction.reply({ content: errorMsg, ephemeral: true });
            }
            
            const averageRating = calculateAverage(targetUser.id);
            let scoreMsg = isSelfCheck ? `🌟 Tvé průměrné hodnocení je: **\`${averageRating.toFixed(2)} / 10\`**` : `🌟 Průměrné hodnocení uživatele ${targetUser.toString()} je: **\`${averageRating.toFixed(2)} / 10\`**`;
            
            await interaction.reply({ content: scoreMsg, ephemeral: isSelfCheck });
        }

        if (commandName === 'scoreboard') {
            await interaction.deferReply();
            const userIds = Object.keys(ratings).filter(id => ratings[id] && ratings[id].length > 0);
            if (userIds.length === 0) {
                return interaction.editReply({ content: 'Síň slávy je prázdná!' });
            }
            
            await interaction.guild.members.fetch({ user: userIds }).catch(() => {});
            userIds.sort((a, b) => calculateAverage(b) - calculateAverage(a));

            const scoreEmbed = new EmbedBuilder().setColor('#5865F2').setTitle('✨🏆 SÍŇ SLÁVY 🏆✨').setDescription('Udržuj si skóre nad **9.0** a získáš přístup do 👑 | VIP kanálu pro volání na streamech!\n\n').setTimestamp().setFooter({ text: 'Vaše chování ovlivňuje vaše skóre. Buďte v pohodě! 😉' });
            
            let leaderboardString = '';
            const topUsers = userIds.slice(0, 25);
            for (let i = 0; i < topUsers.length; i++) {
                const userId = topUsers[i];
                const member = interaction.guild.members.cache.get(userId);
                if (!member) continue;
                
                const averageRating = calculateAverage(userId);
                const roleIndicator = member.roles.cache.has(roleId) ? ' 👑' : '';
                const rank = i + 1;
                let rankDisplay;
                if (rank === 1) rankDisplay = '🥇'; else if (rank === 2) rankDisplay = '🥈'; else if (rank === 3) rankDisplay = '🥉'; else rankDisplay = `**${rank}.**`;
                leaderboardString += `${rankDisplay} ${member.toString()} ⮞ \` ${averageRating.toFixed(2)} / 10 \` ${roleIndicator}\n`;
            }
            scoreEmbed.setDescription(scoreEmbed.data.description + leaderboardString);
            await interaction.editReply({ embeds: [scoreEmbed] });
        }

        if (commandName === 'rate') {
            const user = interaction.options.getUser('uživatel');
            const rating = interaction.options.getNumber('hodnocení');

            if (user.bot) return interaction.reply({ content: 'Boti se nehodnotí.', ephemeral: true });
            if (user.id === interaction.user.id) return interaction.reply({ content: 'Nemůžeš hodnotit sám sebe.', ephemeral: true });
            if (rating < -10 || rating > 10) return interaction.reply({ content: 'Hodnocení musí být v rozmezí -10 až 10.', ephemeral: true });

            addRating(user.id, rating, `Ručně adminem ${interaction.user.tag}`);
            await updateRoleStatus(user.id, interaction.guild);
            const averageRating = calculateAverage(user.id);
            await interaction.reply(`**${user.toString()}** obdržel(a) nové hodnocení! 🔥 Nový průměr: **\`${averageRating.toFixed(2)} / 10\`**`);
        }
    }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (newMember.roles.cache.has(ownerRoleId)) return;
    const oldTimeoutEnd = oldMember.communicationDisabledUntilTimestamp;
    const newTimeoutEnd = newMember.communicationDisabledUntilTimestamp;
    if (newTimeoutEnd && newTimeoutEnd > Date.now() && newTimeoutEnd !== oldTimeoutEnd) {
        addRating(newMember.id, -3, "Důvod: Timeout");
        await updateRoleStatus(newMember.id, newMember.guild, null);
        try {
            const channel = await client.channels.fetch(logChannelId);
            if (channel) channel.send(`Uživatel <@${newMember.id}> dostal timeout a jeho hodnocení bylo sníženo o **3 body**.`);
        } catch (err) {}
    }
});

client.on('guildBanAdd', async (ban) => {
    ratings[ban.user.id] = [0];
    saveRatings();
    await updateRoleStatus(ban.user.id, ban.guild, null);
    try {
        const channel = await client.channels.fetch(logChannelId);
        if (channel) channel.send(`Uživatel **${ban.user.tag}** dostal BAN a jeho hodnocení bylo resetováno na **0**.`);
    } catch (err) {}
});

// ================== ZJEDNODUŠENÝ LISTENER ZPRÁV ==================
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    if (otherBotPrefixes.some(p => message.content.startsWith(p))) return;
    
    // Staré příkazy na `m!` jsou odstraněny. Listener se stará jen o moderaci a aktivitu.
    const wasModerated = await moderateMessage(message);
    if (!wasModerated && message.channel.id === activityChannelId) {
        if (!messageCounts[message.author.id]) messageCounts[message.author.id] = 0;
        messageCounts[message.author.id]++;
        if (messageCounts[message.author.id] >= 10) {
            if (!ratings[message.author.id] || ratings[message.author.id].length === 0) {
                addRating(message.author.id, 5, "Důvod: První odměna za aktivitu");
            } else {
                addRating(message.author.id, 10, "Důvod: Aktivita");
            }
            await updateRoleStatus(message.author.id, message.guild, message);
            messageCounts[message.author.id] = 0;
        }
        saveMessageCounts();
    }
});
client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (newMessage.partial) {
        try { await newMessage.fetch(); } catch { return; }
    }
    if (newMessage.author.bot || !newMessage.guild) return;
    if (oldMessage.content === newMessage.content) return;
    await moderateMessage(newMessage);
});
client.login(process.env.BOT_TOKEN);
