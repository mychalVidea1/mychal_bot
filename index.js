require('dotenv').config();

const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, MessageFlags, Collection } = require('discord.js');
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
const tenorApiKey = process.env.TENOR_API_KEY;
const ownerRoleId = '875091178322812988';
const activityChannelId = '875097279650992128';
const logChannelId = '1025689879973203968';
const startupChannelId = '1025689879973203968';
const aiModerationChannelIds = ['875097279650992128', '1261094481415897128', '1275999194313785415', '1322337083745898616', '1419340737048350880'];
const MAX_WORDS_FOR_AI = 67;
const MIN_CHARS_FOR_AI = 4;
const COOLDOWN_SECONDS = 5;
const NOTIFICATION_COOLDOWN_MINUTES = 10;
const otherBotPrefixes = ['?', '!', 'db!', 'c!', '*'];
const emojiSpamRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|<a?:\w+:\d+>){10,}/;
const mediaUrlRegex = /https?:\/\/(media\.tenor\.com|tenor\.com|giphy\.com|i\.imgur\.com|cdn\.discordapp\.com|media\.discordapp\.net|img\.youtube\.com)\S+/i; // Přidáno media.discordapp.net
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const allowedGuildId = '875027587477409862';

const activeImageModel = 'gemini-2.5-pro';
const firstFallbackImageModel = 'gemini-1.5-pro-latest';
const secondFallbackImageModel = 'gemini-2.5-flash';

const level3Words = [ 'nigga', 'n1gga', 'n*gga', 'niggas', 'nigger', 'n1gger', 'n*gger', 'niggers', 'niga', 'n1ga', 'nygga', 'niggar', 'negr', 'ne*r', 'n*gr', 'n3gr', 'neger', 'negri', 'negry' ];
const level2Words = [ 'kundo', 'kundy', 'píčo', 'pico', 'pičo', 'čuráku', 'curaku', 'čůráku', 'píčus', 'picus', 'zmrd', 'zmrde', 'mrdko', 'buzerant', 'buzna', 'kurva', 'kurvo', 'kurvy', 'čurák', 'curak', 'šukat', 'mrdat', 'bitch', 'b*tch', 'whore', 'slut', 'faggot', 'motherfucker', 'asshole', 'assh*le', 'bastard', 'cunt', 'c*nt', 'dickhead', 'dick', 'pussy', 'fuck', 'f*ck', 'fck', 'kys', 'kill yourself', 'go kill yourself', 'zabij se', 'fuk', 'hitler' ];
const level1Words = [ 'kretén', 'sračka', 'píčo', 'pičo', 'fakin', 'curak', 'píča', 'zkurvysyn', 'dopíči', 'dokundy'];

const level3Regex = new RegExp(`\\b(${level3Words.join('|')})\\b`, 'i');
const level2Regex = new RegExp(`\\b(${level2Words.join('|')})\\b`, 'i');
const level1Regex = new RegExp(`\\b(${level1Words.join('|')})\\b`, 'i');

const userCooldowns = new Map();
let lastLimitNotificationTimestamp = 0;

const userMessageHistory = new Collection();
const SPAM_MESSAGE_COUNT = 7;
const SPAM_MAX_MESSAGE_LENGTH = 3;

const dataDirectory = '/data';
const ratingsFilePath = `${dataDirectory}/ratings.json`;
const messageCountsFilePath = `${dataDirectory}/message_counts.json`;

if (!fs.existsSync(dataDirectory)) fs.mkdirSync(dataDirectory);
let ratings = {};
try { ratings = JSON.parse(fs.readFileSync(ratingsFilePath, 'utf8')); } catch (err) {}
let messageCounts = {};
try { messageCounts = JSON.parse(fs.readFileSync(messageCountsFilePath, 'utf8')); } catch (err) {}

function saveRatings() { try { fs.writeFileSync(ratingsFilePath, JSON.stringify(ratings, null, 2)); } catch (err) { console.error("Chyba při ukládání hodnocení:", err); } }
function saveMessageCounts() { try { fs.writeFileSync(messageCountsFilePath, JSON.stringify(messageCounts, null, 2)); } catch (err) { console.error("Chyba při ukládání počtu zpráv:", err); } }
function getUserRating(userId) { return ratings[userId] || 0.0; }
function updateRating(userId, points, reason = "") { const currentRating = getUserRating(userId); const newRating = Math.max(0, Math.min(10, currentRating + points)); ratings[userId] = newRating; saveRatings(); console.log(`Uživatel ${userId} obdržel ${points} bodů. Nové skóre: ${newRating}. ${reason}`); }

async function updateRoleStatus(userId, guild, sourceMessage = null) { try { if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return; const member = await guild.members.fetch(userId).catch(() => null); const role = guild.roles.cache.get(roleId); if (!member || !role) return; const userRating = getUserRating(userId); const hasRole = member.roles.cache.has(roleId); if (userRating > 9 && !hasRole) { await member.roles.add(role); const messageContent = `🎉 Gratulace, <@${member.id}>! Tvé skóre tě katapultovalo mezi elitu a získal(a) jsi roli **${role.name}**! 🚀`; if (sourceMessage && sourceMessage.channel && !sourceMessage.deleted) { sourceMessage.reply(messageContent).catch(() => {}); } else { const channel = await client.channels.fetch(logChannelId).catch(() => null); if (channel) channel.send(messageContent).catch(() => {}); } } else if (userRating <= 9 && hasRole) { await member.roles.remove(role); const messageContent = `📉 Pozor, <@${member.id}>! Tvé hodnocení kleslo a přišel(a) jsi o roli **${role.name}**. Zaber!`; if (sourceMessage && sourceMessage.channel && !sourceMessage.deleted) { sourceMessage.reply(messageContent).catch(() => {}); } else { const channel = await client.channels.fetch(logChannelId).catch(() => null); if (channel) channel.send(messageContent).catch(() => {}); } } } catch (error) { console.error(`Chyba při aktualizaci role pro ${userId}:`, error); } }

async function applyTimeout(member, durationInMs, reason) {
    if (!member) return;
    try {
        await member.timeout(durationInMs, reason);
        console.log(`Uživatel ${member.user.tag} dostal timeout na ${durationInMs / 1000}s. Důvod: ${reason}`);
    } catch (error) {
        console.error(`Nepodařilo se udělit timeout uživateli ${member.user.tag} (možná nemám oprávnění?):`, error.message);
    }
}

async function analyzeText(text) {
    if (!geminiApiKey) return false;
    const modelsToTry = ['gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'];
    let lastError = null;
    const prompt = `Jsi AI moderátor pro neformální, herní Discord server. Tvým úkolem je odhalit zprávy, které jsou škodlivé. Ignoruj běžné lehké nadávky a přátelské pošťuchování. Zasáhni, pokud zpráva překročí hranici běžného "trash talku" a stane se z ní nenávistný projev, vyhrožování nebo šikana. Je tato zpráva taková? Odpověz jen "ANO" nebo "NE".\n\nText: "${text}"`;
    const requestBody = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 5 } };
    for (const model of modelsToTry) {
        try {
            const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`, requestBody);
            const candidateText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!candidateText) { lastError = new Error("Blocked by safety filter"); continue; }
            const result = candidateText.trim().toUpperCase();
            return result.includes("ANO");
        } catch (error) {
            lastError = error;
            const status = error.response ? error.response.status : null;
            if (status === 429 || status === 404 || status === 500) { continue; }
            else { break; }
        }
    }
    const lastStatus = lastError.response ? lastError.response.status : null;
    if (lastStatus === 429) { return 'API_LIMIT'; }
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
            console.log(`Tenor API označilo GIF ${gifId} jako nevhodný (rated_r).`);
            return 'inappropriate';
        }
        console.log(`Tenor API označilo GIF ${gifId} jako bezpečný (${rating}).`);
        return 'safe';
    } catch (error) {
        console.error("Chyba při komunikaci s Tenor API:", error.message);
        return 'needs_analysis';
    }
}

async function analyzeImage(imageUrl) {
    if (!geminiApiKey) return false;
    const modelsToTry = [activeImageModel, firstFallbackImageModel, secondFallbackImageModel];
    let imageBuffer, mimeType;
    try {
        imageBuffer = (await axios.get(imageUrl, { responseType: 'arraybuffer' })).data;
        mimeType = (await axios.head(imageUrl)).headers['content-type'];
        if (mimeType.startsWith('image/gif')) {
            const frames = await getFrames({ url: imageBuffer, frames: 'all', outputType: 'png', quality: 10 });
            if (frames.length === 0) return false;
            const middleFrameIndex = Math.floor(frames.length / 2);
            const frameStream = frames[middleFrameIndex].getImage();
            const chunks = [];
            await new Promise((resolve, reject) => { frameStream.on('data', chunk => chunks.push(chunk)); frameStream.on('error', reject); frameStream.on('end', resolve); });
            imageBuffer = Buffer.concat(chunks);
            mimeType = 'image/png';
        }
        if (mimeType.startsWith('image/')) {
            imageBuffer = await sharp(imageBuffer).resize({ width: 512, withoutEnlargement: true }).toBuffer();
        } else {
            return false;
        }
    } catch (preprocessingError) {
        if (preprocessingError.response && preprocessingError.response.status === 404) {
            console.warn(`Nepodařilo se stáhnout obrázek (404 Not Found) z URL: ${imageUrl}. Pravděpodobně byl smazán nebo odkaz vypršel.`);
        } else {
            console.error("Chyba při zpracování obrázku před analýzou:", preprocessingError.message);
        }
        return 'FILTERED';
    }
    const base64Image = imageBuffer.toString('base64');
    const prompt = `Jsi AI moderátor pro herní Discord server. Posuď, jestli je tento obrázek skutečně nevhodný pro komunitu (pornografie, gore, explicitní násilí, nenávistné symboly, rasismus). Ignoruj herní násilí (střílení ve hrách), krev ve hrách, herní rozhraní (UI) a běžné internetové memy, které nejsou extrémní. Buď shovívavý k textu na screenshotech. Odpověz jen "ANO" (pokud je nevhodný) nebo "NE" (pokud je v pořádku).`;
    const requestBody = { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }] }] };
    for (const model of modelsToTry) {
        try {
            const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`, requestBody);
            if (!response.data.candidates || response.data.candidates.length === 0) {
                return 'FILTERED';
            }
            const result = response.data.candidates[0].content.parts[0].text.trim().toUpperCase();
            return result.includes("ANO");
        } catch (error) {
             const status = error.response ? error.response.status : null;
            if (status === 429 || status === 404 || status === 500 || status === 503) {
                continue;
            } else {
                break;
            }
        }
    }
    return 'FILTERED';
}

async function moderateMessage(message) {
    if (!message.guild || !message.author || message.author.bot) return false;
    const member = message.member;
    if (!member || member.roles.cache.has(ownerRoleId)) return false;
    if (!aiModerationChannelIds.includes(message.channel.id)) return false;

    let mediaUrl = null;
    if (message.attachments.size > 0) { const attachment = message.attachments.first(); if (attachment.size < MAX_FILE_SIZE_BYTES && (attachment.contentType?.startsWith('image/') || attachment.contentType?.startsWith('video/'))) { mediaUrl = attachment.url; } }
    if (!mediaUrl && message.embeds.length > 0) { const embed = message.embeds[0]; if (embed.image) mediaUrl = embed.image.url; else if (embed.thumbnail) mediaUrl = embed.thumbnail.url; }
    if (!mediaUrl) { 
        const match = message.content.match(mediaUrlRegex);
        if (match) mediaUrl = match[0];
    }

    if (mediaUrl) {
        // ===== OPRAVA ZDE: Čistíme URL jen pokud to není odkaz z Discordu =====
        let cleanMediaUrl = mediaUrl;
        if (!mediaUrl.includes('cdn.discordapp.com') && !mediaUrl.includes('media.discordapp.net')) {
            // Tento řádek odstraňoval tokeny, teď je to bezpečné
            cleanMediaUrl = mediaUrl.split('?')[0];
        }
        
        const isTenorGif = /https?:\/\/(media\.)?tenor\.com/.test(cleanMediaUrl);
        let tenorCheckResult = 'needs_analysis';

        if (isTenorGif) {
            tenorCheckResult = await checkTenorGif(cleanMediaUrl);
        }

        if (tenorCheckResult === 'inappropriate') {
            updateRating(message.author.id, -1.5, `Důvod: Nevhodný GIF (detekováno Tenor API)`);
            await applyTimeout(member, 60 * 1000, 'Nahrání nevhodného GIFu');
            await updateRoleStatus(message.author.id, message.guild, message);
            try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, tvůj GIF byl nevhodný. Bylo ti sníženo hodnocení a dostal jsi **timeout na 60 sekund**.`); setTimeout(() => warningMsg.delete().catch(() => {}), 15000); } catch (err) {}
            return true;
        }
        
        if (tenorCheckResult === 'needs_analysis') {
            const imageResult = await analyzeImage(cleanMediaUrl);
            if (imageResult === true) {
                updateRating(message.author.id, -1.5, `Důvod: Nevhodný obrázek/GIF (detekováno AI)`);
                await applyTimeout(member, 60 * 1000, 'Nahrání nevhodného obrázku');
                await updateRoleStatus(message.author.id, message.guild, message);
                try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, tvůj obrázek byl nevhodný. Bylo ti sníženo hodnocení a dostal jsi **timeout na 60 sekund**.`); setTimeout(() => warningMsg.delete().catch(() => {}), 15000); } catch (err) {}
                return true;
            } else if (imageResult === 'FILTERED') {
                const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
                if (logChannel) {
                    const embed = new EmbedBuilder().setColor('#FFA500').setTitle('⚠️ AI Moderace Selhala').setDescription(`AI nedokázala analyzovat obrázek od <@${message.author.id}>.\nŽádám o lidský posudek.`).setImage(cleanMediaUrl).addFields({ name: 'Odkaz na zprávu', value: `[Klikni zde](${message.url})` }).setTimestamp();
                    const row = new ActionRowBuilder().addComponents( new ButtonBuilder().setCustomId(`approve-${message.id}-${message.author.id}`).setLabel('✅ Ponechat').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`punish-${message.id}-${message.author.id}`).setLabel('❌ Smazat a potrestat').setStyle(ButtonStyle.Danger) );
                    await logChannel.send({ embeds: [embed], components: [row] });
                }
            }
        }
    }

    let textToAnalyze = message.content.replace(mediaUrlRegex, '').trim();
    if (textToAnalyze.length === 0 && message.embeds.length > 0) { const embed = message.embeds[0]; if (embed.description) textToAnalyze = embed.description; }
    if (textToAnalyze.length === 0) return false;

    if (level3Regex.test(textToAnalyze)) {
        ratings[message.author.id] = 0.0; saveRatings();
        await applyTimeout(member, 60 * 60 * 1000, 'Použití přísně zakázaného slova');
        await updateRoleStatus(message.author.id, message.guild, message);
        try { await message.delete(); const warningMsg = await message.channel.send(`Uživatel <@${message.author.id}> použil přísně zakázané slovo. Hodnocení bylo **resetováno na 0** a byl udělen **timeout na 1 hodinu**!`); setTimeout(() => warningMsg.delete().catch(() => {}), 20000); } catch (err) {}
        return true;
    }
    if (level2Regex.test(textToAnalyze)) {
        updateRating(message.author.id, -2, "Důvod: Hrubá urážka");
        await applyTimeout(member, 5 * 60 * 1000, 'Použití hrubé urážky');
        await updateRoleStatus(message.author.id, message.guild, message);
        try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, za toto chování ti byl snížen rating o **2 body** a byl udělen **timeout na 5 minut**.`); setTimeout(() => warningMsg.delete().catch(() => {}), 10000); } catch (err) {}
        return true;
    }
    if (level1Regex.test(textToAnalyze)) {
        try { const warningReply = await message.reply(`Slovník prosím. 🤫`); setTimeout(() => warningReply.delete().catch(() => {}), 10000); } catch (err) {}
        return true;
    }

    if (emojiSpamRegex.test(textToAnalyze)) {
        try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, hoď se do klidu, tolik emoji není nutný! 😂`); setTimeout(() => warningMsg.delete().catch(() => {}), 10000); } catch (err) {}
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
                updateRating(message.author.id, -1, `Důvod: Toxická zpráva (detekováno AI)`);
                await updateRoleStatus(message.author.id, message.guild, message);
                try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, tvá zpráva byla nevhodná a tvé hodnocení bylo sníženo o **1 bod**.`); setTimeout(() => warningMsg.delete().catch(() => {}), 15000); } catch (err) {}
                return true;
            } else if (toxicityResult === 'API_LIMIT') {
                const now = Date.now();
                if (now - lastLimitNotificationTimestamp > NOTIFICATION_COOLDOWN_MINUTES * 60 * 1000) {
                    lastLimitNotificationTimestamp = now;
                    try { const reply = await message.reply(`AI nemohla tuto zprávu ověřit, protože si dala šlofíka na pár hodin!`); setTimeout(() => reply.delete().catch(() => {}), 300000); } catch(err) {}
                }
            }
        }
    }
    return false;
}

async function checkRepetitiveSpam(message) {
    if (!message.guild || message.author.bot) return false;
    if (!userMessageHistory.has(message.author.id)) {
        userMessageHistory.set(message.author.id, new Collection());
    }
    const userHistory = userMessageHistory.get(message.author.id);
    userHistory.set(message.id, { content: message.content });

    if (userHistory.size > SPAM_MESSAGE_COUNT) {
        userHistory.delete(userHistory.firstKey());
    }
    if (userHistory.size < SPAM_MESSAGE_COUNT) return false;

    const firstMessageContent = userHistory.first().content;
    const isSpam = userHistory.every(msg => msg.content === firstMessageContent && msg.content.length <= SPAM_MAX_MESSAGE_LENGTH);

    if (isSpam) {
        const messagesToDelete = [...userHistory.keys()];
        userMessageHistory.delete(message.author.id);

        try {
            await message.channel.bulkDelete(messagesToDelete);
            await applyTimeout(message.member, 60 * 1000, 'Spamování krátkých zpráv');
            const warningMsg = await message.channel.send(`<@${message.author.id}>, přestaň spamovat! Dostal jsi **timeout na 60 sekund**.`);
            setTimeout(() => warningMsg.delete().catch(() => {}), 15000);
        } catch (err) { console.error("Chyba při mazání spamu:", err); }
        return true;
    }
    return false;
}

client.once('clientReady', async () => {
    console.log(`Bot je online jako ${client.user.tag}!`);
    try {
        console.log('Započato obnovování aplikačních (/) příkazů pro server.');
        const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
        const commands = [
            new SlashCommandBuilder().setName('rate').setDescription('Ohodnotí uživatele (pouze pro majitele).').addUserOption(option => option.setName('uživatel').setDescription('Uživatel, kterého chceš ohodnotit.').setRequired(true)).addNumberOption(option => option.setName('hodnocení').setDescription('Číslo od 0 do 10.').setRequired(true).setMinValue(0).setMaxValue(10)).setDMPermission(false),
            new SlashCommandBuilder().setName('score').setDescription('Zobrazí tvé hodnocení nebo hodnocení jiného uživatele.').addUserOption(option => option.setName('uživatel').setDescription('Uživatel, jehož skóre chceš vidět.').setRequired(false)).setDMPermission(false),
            new SlashCommandBuilder().setName('scoreboard').setDescription('Zobrazí síň slávy - žebříček všech uživatelů.').setDMPermission(false),
            new SlashCommandBuilder().setName('resetscoreboard').setDescription('Smaže všechna data hodnocení (pouze pro majitele).').setDMPermission(false),
            new SlashCommandBuilder().setName('list-servers').setDescription('Vypíše seznam serverů, kde se bot nachází (pouze pro majitele).').setDMPermission(false),
            new SlashCommandBuilder().setName('leave-server').setDescription('Přinutí bota opustit server podle ID (pouze pro majitele).').addStringOption(option => option.setName('id').setDescription('ID serveru, který má bot opustit.').setRequired(true)).setDMPermission(false),
        ].map(command => command.toJSON());

        const clientId = process.env.CLIENT_ID;
        const guildId = process.env.GUILD_ID;
        if (!clientId || !guildId) { throw new Error("CLIENT_ID nebo GUILD_ID není nastaveno v .env souboru!"); }
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
        console.log('Úspěšně obnoveny aplikační příkazy pro server.');
    } catch (error) { console.error('Chyba při registraci (/) příkazů:', error); }
    try {
        const channel = await client.channels.fetch(startupChannelId);
        if (channel) {
            const startupEmbed = new EmbedBuilder().setColor('#00FF00').setTitle('🚀 JSEM ZPÁTKY ONLINE! 🚀').setDescription('Systémy nastartovány, databáze pročištěna. Jsem připraven hodnotit vaše chování! 👀').setImage('https://tenor.com/view/robot-ai-artificial-intelligence-hello-waving-gif-14586208').setTimestamp().setFooter({ text: 'mychalVidea' });
            await channel.send({ embeds: [startupEmbed] });
        }
    } catch (error) {}
    console.log('Kontroluji servery...');
    client.guilds.cache.forEach(guild => { if (guild.id !== allowedGuildId) { console.log(`Opouštím nepovolený server: ${guild.name} (ID: ${guild.id})`); guild.leave().catch(err => console.error(`Nepodařilo se opustit server ${guild.name}:`, err)); } });
});

client.on('guildCreate', guild => { if (guild.id !== allowedGuildId) { console.log(`Byl jsem přidán na nepovolený server: ${guild.name} (ID: ${guild.id}). Okamžitě ho opouštím.`); guild.leave().catch(err => console.error(`Nepodařilo se opustit nově přidaný server ${guild.name}:`, err)); } });

client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'K této akci nemáš oprávnění.', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const [action, originalMessageId, authorId] = interaction.customId.split('-');
        const logMessage = await interaction.channel.messages.fetch(interaction.message.id).catch(() => null);
        if (action === 'approve') {
            if (logMessage) { const embed = new EmbedBuilder(logMessage.embeds[0].data).setColor('#00FF00').setTitle('✅ Obrázek Schválen').setDescription(`Obrázek od <@${authorId}> byl schválen moderátorem <@${interaction.user.id}>.`).setFields([]); await logMessage.edit({ embeds: [embed], components: [] }); }
            return interaction.editReply({ content: 'Obrázek byl schválen.' });
        } else if (action === 'punish') {
            const memberToPunish = await interaction.guild.members.fetch(authorId).catch(() => null);
            updateRating(authorId, -2.5, 'Důvod: Nevhodný obrázek (zamítnuto moderátorem)');
            await applyTimeout(memberToPunish, 60 * 1000, 'Nahrání nevhodného obrázku (manuální trest)');

            if (logMessage && logMessage.embeds[0] && logMessage.embeds[0].fields[0]) {
                const messageUrl = logMessage.embeds[0].fields[0].value;
                const urlParts = messageUrl.match(/channels\/\d+\/(\d+)\/(\d+)/);
                if (urlParts) {
                    const [_, channelId, messageId] = urlParts;
                    const channel = await client.channels.fetch(channelId).catch(() => null);
                    if (channel) { const messageToDelete = await channel.messages.fetch(messageId).catch(() => null); if (messageToDelete) { await messageToDelete.delete().catch(err => console.error("Nepodařilo se smazat zprávu po potrestání:", err)); } }
                }
            }
            await updateRoleStatus(authorId, interaction.guild);
            if (logMessage) { const embed = new EmbedBuilder(logMessage.embeds[0].data).setColor('#FF0000').setTitle('❌ Obrázek Zamítnut a Potrestán').setDescription(`Uživatel <@${authorId}> byl potrestán moderátorem <@${interaction.user.id}>.\nHodnocení sníženo o **2.5** bodu, udělen **timeout na 60 sekund**`).setFields([]); await logMessage.edit({ embeds: [embed], components: [] }); }
            return interaction.editReply({ content: `Uživatel byl potrestán, hodnocení sníženo a byl udělen timeout na 60 sekund.` });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;
    const ownerId = process.env.OWNER_ID;

    if (commandName === 'list-servers' || commandName === 'leave-server') {
        if (interaction.user.id !== ownerId) { return interaction.reply({ content: 'Tento příkaz může použít pouze majitel bota.', flags: MessageFlags.Ephemeral }); }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (commandName === 'list-servers') { const guilds = client.guilds.cache.map(guild => `${guild.name} (ID: ${guild.id})`).join('\n'); const content = `Bot se nachází na ${client.guilds.cache.size} serverech:\n\n${guilds}`; if (content.length > 2000) { const buffer = Buffer.from(content, 'utf-8'); return interaction.editReply({ content: 'Seznam serverů je příliš dlouhý, posílám ho jako soubor.', files: [{ attachment: buffer, name: 'server-list.txt' }] }); } return interaction.editReply({ content }); }
        if (commandName === 'leave-server') { const guildId = interaction.options.getString('id'); const guild = client.guilds.cache.get(guildId); if (!guild) { return interaction.editReply({ content: `Chyba: Bot není na žádném serveru s ID \`${guildId}\`.` }); } try { await guild.leave(); return interaction.editReply({ content: `✅ Úspěšně jsem opustil server **${guild.name}**.` }); } catch (err) { console.error(`Nepodařilo se opustit server ${guildId}:`, err); return interaction.editReply({ content: `❌ Nepodařilo se opustit server. Důvod: ${err.message}` }); } }
    }

    if (commandName === 'resetscoreboard') {
        if (!interaction.member.roles.cache.has(ownerRoleId)) { return interaction.reply({ content: 'K tomuto příkazu má přístup pouze majitel serveru.', flags: MessageFlags.Ephemeral }); }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        ratings = {};
        messageCounts = {};
        saveRatings();
        saveMessageCounts();
        return interaction.editReply({ content: '✅ Všechna data hodnocení a počtu zpráv byla úspěšně smazána.' });
    }

    if (commandName === 'rate') {
        if (!interaction.member.roles.cache.has(ownerRoleId)) { return interaction.reply({ content: 'K tomuto příkazu má přístup pouze majitel serveru.', flags: MessageFlags.Ephemeral }); }
        await interaction.deferReply();
        const user = interaction.options.getUser('uživatel');
        const ratingInput = interaction.options.getNumber('hodnocení');
        if (user.id === interaction.user.id) { return interaction.editReply({ content: 'Snažíš se sám sobě dát hodnocení, co? Hezký pokus. 😂'}); }
        if (user.bot) { return interaction.editReply({ content: 'Boti se nedají hodnotit, kámo.'}); }
        const currentRating = getUserRating(user.id);
        let newRating = (currentRating + ratingInput) / 2;
        newRating = Math.max(0, Math.min(10, newRating));
        ratings[user.id] = newRating;
        saveRatings();
        console.log(`Uživatel ${user.id} byl ohodnocen adminem ${interaction.user.tag}. Nové skóre: ${newRating}.`);
        await updateRoleStatus(user.id, interaction.guild);
        await interaction.editReply({ content: `**<@${user.id}>** obdržel(a) nové hodnocení! 🔥 Nové skóre: **\`${newRating.toFixed(2)} / 10\`**` });
    }

    if (commandName === 'score') {
        const targetUser = interaction.options.getUser('uživatel') || interaction.user;
        const isSelfCheck = targetUser.id === interaction.user.id;
        await interaction.deferReply({ flags: isSelfCheck ? MessageFlags.Ephemeral : 0 });
        const userRating = getUserRating(targetUser.id);
        const scoreMsg = isSelfCheck ? `🌟 Tvé hodnocení je: **\`${userRating.toFixed(2)} / 10\`**` : `🌟 Hodnocení uživatele <@${targetUser.id}> je: **\`${userRating.toFixed(2)} / 10\`**`;
        await interaction.editReply({ content: scoreMsg });
    }

    if (commandName === 'scoreboard') {
        await interaction.deferReply();
        const userIds = Object.keys(ratings);
        if (userIds.length === 0) { return interaction.editReply({ content: 'Síň slávy je prázdná!' }); }
        await interaction.guild.members.fetch({ user: userIds }).catch(() => {});
        userIds.sort((a, b) => getUserRating(b) - getUserRating(a));
        const scoreEmbed = new EmbedBuilder().setColor('#5865F2').setTitle('✨🏆 SÍŇ SLÁVY 🏆✨').setDescription('Udržuj si skóre nad **9.0** a získáš přístup do 👑 | VIP kanálu pro volání na streamech!\n\n').setTimestamp().setFooter({ text: 'Vaše chování ovlivňuje vaše skóre. Buďte v pohodě! 😉' });
        let leaderboardString = '';
        let rank = 1;
        for (const userId of userIds.slice(0, 25)) {
            const userRating = getUserRating(userId);
            const member = interaction.guild.members.cache.get(userId);
            if (!member) continue;
            let roleIndicator = (member.roles.cache.has(roleId)) ? ' 👑' : '';
            let rankDisplay;
            if (rank === 1) rankDisplay = '🥇'; else if (rank === 2) rankDisplay = '🥈'; else if (rank === 3) rankDisplay = '🥉'; else rankDisplay = `**${rank}.**`;
            leaderboardString += `${rankDisplay} <@${userId}> ⮞ \` ${userRating.toFixed(2)} / 10 \` ${roleIndicator}\n`;
            rank++;
        }
        if (leaderboardString === '') { return interaction.editReply({ content: 'V síni slávy zatím nikdo není, kdo by stál za řeč!' }); }
        scoreEmbed.setDescription(scoreEmbed.data.description + leaderboardString);
        await interaction.editReply({ embeds: [scoreEmbed] });
    }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (newMember.roles.cache.has(ownerRoleId)) return;
});

client.on('guildBanAdd', async (ban) => {
    ratings[ban.user.id] = 0.0;
    saveRatings();
    await updateRoleStatus(ban.user.id, ban.guild, null);
    try { const channel = await client.channels.fetch(logChannelId); if (channel) channel.send(`Uživatel **${ban.user.tag}** dostal BAN a jeho hodnocení bylo resetováno na **0**.`); } catch (err) {}
});
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    if (otherBotPrefixes.some(p => message.content.startsWith(p)) || message.content.startsWith(prefix)) return;

    const wasSpam = await checkRepetitiveSpam(message);
    if (wasSpam) return;

    const wasModerated = await moderateMessage(message);
    if (!wasModerated && message.channel.id === activityChannelId) {
        if (!messageCounts[message.author.id]) messageCounts[message.author.id] = 0;
        messageCounts[message.author.id]++;
        if (messageCounts[message.author.id] >= 10) {
            updateRating(message.author.id, 0.2, "Důvod: Aktivita");
            await updateRoleStatus(message.author.id, message.guild, message);
            messageCounts[message.author.id] = 0;
        }
        saveMessageCounts();
    }
});
client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (newMessage.partial) { try { await newMessage.fetch(); } catch { return; } }
    if (newMessage.author.bot || !newMessage.guild) return;
    if (oldMessage.content === newMessage.content) return;
    await moderateMessage(newMessage);
});

client.login(process.env.BOT_TOKEN);
