require('dotenv').config();

const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { MongoClient } = require('mongodb');
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
const errorGif = 'https://tenor.com/lVEfXc8hvbP.gif';
const ownerRoleId = '875091178322812988';
const activityChannelId = '875097279650992128';
const startupChannelId = '1005985776158388264';
const logChannelId = '1025689879973203968';
const aiModerationChannelIds = ['875097279650992128', '1261094481415897128', '1275999194313785415', '1322337083745898616', '1419340737048350880'];
const MAX_WORDS_FOR_AI = 67;
const MIN_CHARS_FOR_AI = 4;
const COOLDOWN_SECONDS = 5;
const NOTIFICATION_COOLDOWN_MINUTES = 10;
const otherBotPrefixes = ['?', '!', 'db!', 'c!', '*'];
const emojiSpamRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|<a?:\w+:\d+>){10,}/;
const mediaUrlRegex = /https?:\/\/(media\.tenor\.com|tenor\.com|giphy\.com|i\.imgur\.com|cdn\.discordapp\.com|img\.youtube\.com)\S+(?:\.gif|\.png|\.jpg|\.jpeg|\.webp|\.mp4)/i;
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const allowedGuildId = '875027587477409862';

const mongoUri = process.env.MONGO_URL;
if (!mongoUri) { throw new Error("MONGO_URL není nastaveno v proměnných!"); }
const mongoClient = new MongoClient(mongoUri);
let db;

const activeImageModel = 'gemini-2.5-pro';
const firstFallbackImageModel = 'gemini-1.5-pro-latest';
const secondFallbackImageModel = 'gemini-2.5-flash';
let hasSwitchedToFirstFallback = false;
let hasSwitchedToSecondFallback = false;

const level3Words = [ 'nigga', 'n1gga', 'n*gga', 'niggas', 'nigger', 'n1gger', 'n*gger', 'niggers', 'niga', 'n1ga', 'nygga', 'niggar', 'negr', 'ne*r', 'n*gr', 'n3gr', 'neger', 'negri', 'negry' ];
const level2Words = [ 'kundo', 'kundy', 'píčo', 'pico', 'pičo', 'čuráku', 'curaku', 'čůráku', 'píčus', 'picus', 'zmrd', 'zmrde', 'mrdko', 'buzerant', 'buzna', 'kurva', 'kurvo', 'kurvy', 'čurák', 'curak', 'šukat', 'mrdat', 'bitch', 'b*tch', 'whore', 'slut', 'faggot', 'motherfucker', 'asshole', 'assh*le', 'bastard', 'cunt', 'c*nt', 'dickhead', 'dick', 'pussy', 'fuck', 'f*ck', 'fck', 'kys', 'kill yourself', 'go kill yourself', 'zabij se', 'fuk', 'hitler' ];
const level1Words = [ 'kretén', 'sračka', 'píčo', 'pičo', 'fakin', 'curak', 'píča', 'zkurvysyn', 'dopíči', 'dokundy'];
const level3Regex = new RegExp(`\\b(${level3Words.join('|')})\\b`, 'i');
const level2Regex = new RegExp(`\\b(${level2Words.join('|')})\\b`, 'i');
const level1Regex = new RegExp(`\\b(${level1Words.join('|')})\\b`, 'i');
const userCooldowns = new Map();
let lastLimitNotificationTimestamp = 0;

async function getAverageRating(userId) {
    if (!db) return 0.0;
    const ratingsCollection = db.collection('ratings');
    const userData = await ratingsCollection.findOne({ _id: userId });
    return userData ? userData.average : 0.0;
}

async function updateRating(userId, newRatingValue, reason = "") {
    if (!db) return;
    const currentAverage = await getAverageRating(userId);
    const newAverage = (currentAverage + newRatingValue) / 2;
    const ratingsCollection = db.collection('ratings');
    await ratingsCollection.updateOne({ _id: userId }, { $set: { average: newAverage } }, { upsert: true });
    console.log(`Uživatel ${userId} dostal hodnocení ${newRatingValue}. Nový průměr: ${newAverage.toFixed(2)}. Důvod: ${reason}`);
}

async function resetRating(userId, reason = "") {
    if (!db) return;
    const ratingsCollection = db.collection('ratings');
    await ratingsCollection.updateOne({ _id: userId }, { $set: { average: 0.0 } }, { upsert: true });
    console.log(`Hodnocení pro uživatele ${userId} bylo resetováno na 0. Důvod: ${reason}`);
}

async function addActivityRating(userId, reason = "") {
    if (!db) return;
    const ratingsCollection = db.collection('ratings');
    const result = await ratingsCollection.findOneAndUpdate(
        { _id: userId },
        { $inc: { average: 0.1 } },
        { upsert: true, returnDocument: 'after' }
    );
    const newAverage = result.average;
    console.log(`Uživatel ${userId} dostal +0.1 za aktivitu. Nový průměr: ${newAverage.toFixed(2)}. Důvod: ${reason}`);
}

async function updateRoleStatus(userId, guild, sourceMessage = null) {
    try {
        if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return;
        const member = await guild.members.fetch(userId).catch(() => null);
        const role = guild.roles.cache.get(roleId);
        if (!member || !role) return;
        const averageRating = await getAverageRating(userId);
        const hasRole = member.roles.cache.has(roleId);
        if (averageRating > 9 && !hasRole) {
            await member.roles.add(role);
            const messageContent = `🎉 Gratulace, <@${member.id}>! Tvé skóre tě katapultovalo mezi elitu a získal(a) jsi roli **${role.name}**! 🚀`;
            if (sourceMessage?.channel && !sourceMessage?.deleted) sourceMessage.reply(messageContent).catch(() => {});
        } else if (averageRating <= 9 && hasRole) {
            await member.roles.remove(role);
            const messageContent = `📉 Pozor, <@${member.id}>! Tvé hodnocení kleslo a přišel(a) jsi o roli **${role.name}**. Zaber!`;
            if (sourceMessage?.channel && !sourceMessage?.deleted) sourceMessage.reply(messageContent).catch(() => {});
        }
    } catch (error) {}
}

async function analyzeText(text) {
    if (!geminiApiKey) return false;
    const modelsToTry = ['gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'];
    const prompt = `Jsi AI moderátor pro neformální, herní Discord server. Tvým úkolem je odhalit zprávy, které jsou škodlivé. Ignoruj běžné lehké nadávky a přátelské pošťuchování. Zasáhni, pokud zpráva překročí hranici běžného "trash talku" a stane se z ní nenávistný projev, vyhrožování nebo šikana. Je tato zpráva taková? Odpověz jen "ANO" nebo "NE".\n\nText: "${text}"`;
    const requestBody = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 5 } };
    for (const model of modelsToTry) {
        try {
            const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`, requestBody);
            const candidateText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!candidateText) continue;
            const result = candidateText.trim().toUpperCase();
            return result.includes("ANO");
        } catch (error) { continue; }
    }
    return false;
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
        } else { return false; }
    } catch (preprocessingError) { return 'FILTERED'; }
    const base64Image = imageBuffer.toString('base64');
    const prompt = `Jsi AI moderátor pro herní Discord server. Posuď, jestli je tento obrázek skutečně nevhodný pro komunitu (pornografie, gore, explicitní násilí, nenávistné symboly, rasismus). Ignoruj herní násilí (střílení ve hrách), krev ve hrách, herní rozhraní (UI) a běžné internetové memy, které nejsou extrémní. Buď shovívavý k textu na screenshotech. Odpověz jen "ANO" (pokud je nevhodný) nebo "NE" (pokud je v pořádku).`;
    const requestBody = { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }] }] };
    for (const model of modelsToTry) {
        try {
            const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`, requestBody);
            if (!response.data.candidates || response.data.candidates.length === 0) { return 'FILTERED'; }
            const result = response.data.candidates[0].content.parts[0].text.trim().toUpperCase();
            return result.includes("ANO");
        } catch (error) { continue; }
    }
    return 'FILTERED';
}

async function moderateMessage(message) {
    if (!message.guild || !message.author || message.author.bot) return false;
    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member || member.roles.cache.has(ownerRoleId)) return false;
    if (!aiModerationChannelIds.includes(message.channel.id)) return false;

    let mediaUrl = null;
    if (message.attachments.size > 0) { const attachment = message.attachments.first(); if (attachment.size < MAX_FILE_SIZE_BYTES && (attachment.contentType?.startsWith('image/') || attachment.contentType?.startsWith('video/'))) { mediaUrl = attachment.url; } }
    if (!mediaUrl && message.embeds.length > 0) { const embed = message.embeds[0]; if (embed.image) mediaUrl = embed.image.url; else if (embed.thumbnail) mediaUrl = embed.thumbnail.url; }
    if (!mediaUrl) { const match = message.content.match(mediaUrlRegex); if (match) mediaUrl = match[0]; }

    if (mediaUrl) {
        let cleanMediaUrl = mediaUrl;
        if (cleanMediaUrl.includes('?')) { cleanMediaUrl = cleanMediaUrl.split('?')[0]; }
        const imageResult = await analyzeImage(cleanMediaUrl);
        if (imageResult === true) {
            await updateRating(message.author.id, -2, "Nevhodný obrázek/GIF");
            await updateRoleStatus(message.author.id, message.guild, message);
            try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, tvůj obrázek/GIF byl vyhodnocen jako nevhodný a tvé hodnocení bylo sníženo.`); setTimeout(() => warningMsg.delete().catch(() => {}), 15000); } catch (err) {}
            return true;
        } else if (imageResult === 'FILTERED') {
            const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) {
                const embed = new EmbedBuilder().setColor('#FFA500').setTitle('⚠️ AI Moderace Selhala').setDescription(`AI nedokázala analyzovat obrázek od <@${message.author.id}>.\nŽádám o lidský posudek.`).setImage(cleanMediaUrl).addFields({ name: 'Odkaz na zprávu', value: `[Klikni zde](${message.url})` }).setTimestamp();
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`approve-${message.id}-${message.author.id}`).setLabel('✅ Ponechat').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`punish-${message.id}-${message.author.id}`).setLabel('❌ Smazat a potrestat').setStyle(ButtonStyle.Danger));
                await logChannel.send({ embeds: [embed], components: [row] });
            }
        }
    }

    let textToAnalyze = message.content.replace(mediaUrlRegex, '').trim();
    if (textToAnalyze.length === 0 && message.embeds.length > 0) { const embed = message.embeds[0]; if (embed.description) textToAnalyze = embed.description; }
    if (textToAnalyze.length === 0) return false;

    if (level3Regex.test(textToAnalyze)) { await resetRating(message.author.id, "Zakázané slovo"); await updateRoleStatus(message.author.id, message.guild, message); try { await message.delete(); const warningMsg = await message.channel.send(`Uživatel <@${message.author.id}> použil přísně zakázané slovo. Tvoje hodnocení bylo **resetováno na 0**!`); setTimeout(() => warningMsg.delete().catch(() => {}), 20000); } catch (err) {} return true; }
    if (level2Regex.test(textToAnalyze)) { await updateRating(message.author.id, -3, "Hrubá urážka"); await updateRoleStatus(message.author.id, message.guild, message); try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, za toto chování ti byl snížen rating o **3 body**.`); setTimeout(() => warningMsg.delete().catch(() => {}), 10000); } catch (err) {} return true; }
    if (level1Regex.test(textToAnalyze)) { await updateRating(message.author.id, -1, "Nevhodné slovo"); await updateRoleStatus(message.author.id, message.guild, message); try { const warningReply = await message.reply(`Slovník prosím. 🤫 Za tuto zprávu ti byl lehce snížen rating.`); setTimeout(() => warningReply.delete().catch(() => {}), 10000); } catch (err) {} return true; }
    if (emojiSpamRegex.test(textToAnalyze)) { try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, hoď se do klidu, tolik emoji není nutný! 😂`); setTimeout(() => warningMsg.delete().catch(() => {}), 10000); } catch (err) {} return true; }

    const wordCount = textToAnalyze.split(' ').length;
    if (textToAnalyze.length >= MIN_CHARS_FOR_AI && wordCount <= MAX_WORDS_FOR_AI) {
        const now = Date.now();
        const lastCheck = userCooldowns.get(message.author.id);
        if (!lastCheck || (now - lastCheck > COOLDOWN_SECONDS * 1000)) {
            userCooldowns.set(message.author.id, now);
            const toxicityResult = await analyzeText(textToAnalyze);
            if (toxicityResult === true) { await updateRating(message.author.id, -2, `Toxická zpráva (AI)`); await updateRoleStatus(message.author.id, message.guild, message); try { await message.delete(); const warningMsg = await message.channel.send(`<@${message.author.id}>, tvá zpráva byla nevhodná a tvé hodnocení bylo sníženo.`); setTimeout(() => warningMsg.delete().catch(() => {}), 15000); } catch (err) {} return true; } 
            else if (toxicityResult === 'API_LIMIT') { const now = Date.now(); if (now - lastLimitNotificationTimestamp > NOTIFICATION_COOLDOWN_MINUTES * 60 * 1000) { lastLimitNotificationTimestamp = now; try { const reply = await message.reply(`AI nemohla tuto zprávu ověřit, protože si dala šlofíka na pár hodin!`); setTimeout(() => reply.delete().catch(() => {}), 300000); } catch(err) {} } }
        }
    }
    return false;
}

client.once('clientReady', async () => {
    try {
        await mongoClient.connect();
        db = mongoClient.db();
        console.log('Úspěšně připojeno k MongoDB databázi.');
    } catch (err) {
        console.error('Kritická chyba: Nepodařilo se připojit k MongoDB!', err);
        process.exit(1);
    }
    
    console.log(`Bot je online jako ${client.user.tag}!`);
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
        const commands = [
            new SlashCommandBuilder().setName('rate').setDescription('Ohodnotí uživatele (pouze pro majitele s rolí).').addUserOption(option => option.setName('uživatel').setDescription('Uživatel, kterého chceš ohodnotit.').setRequired(true)).addNumberOption(option => option.setName('hodnocení').setDescription('Číslo od -10 do 10.').setRequired(true).setMinValue(-10).setMaxValue(10)).setDMPermission(false),
            new SlashCommandBuilder().setName('score').setDescription('Zobrazí tvé hodnocení nebo hodnocení jiného uživatele.').addUserOption(option => option.setName('uživatel').setDescription('Uživatel, jehož skóre chceš vidět.').setRequired(false)).setDMPermission(false),
            new SlashCommandBuilder().setName('leaderboard').setDescription('Zobrazí síň slávy - žebříček všech uživatelů.').setDMPermission(false),
            new SlashCommandBuilder().setName('list-servers').setDescription('Vypíše seznam serverů, kde se bot nachází (pouze pro majitele).').setDMPermission(false),
            new SlashCommandBuilder().setName('leave-server').setDescription('Přinutí bota opustit server podle ID (pouze pro majitele).').addStringOption(option => option.setName('id').setDescription('ID serveru, který má bot opustit.').setRequired(true)).setDMPermission(false),
        ].map(command => command.toJSON());
        
        const clientId = process.env.CLIENT_ID;
        const guildId = process.env.GUILD_ID;
        if (!clientId || !guildId) { throw new Error("CLIENT_ID nebo GUILD_ID není nastaveno!"); }
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
        console.log('Úspěšně obnoveny aplikační příkazy pro server.');
    } catch (error) { console.error('Chyba při registraci (/) příkazů:', error); }
    
    try {
        const channel = await client.channels.fetch(startupChannelId);
        if (channel) {
            const startupEmbed = new EmbedBuilder().setColor('#00FF00').setTitle('🚀 JSEM ZPÁTKY ONLINE! 🚀').setDescription('Systémy nastartovány, databáze připravena. Jsem připraven hodnotit vaše chování! 👀').setImage('https://tenor.com/view/robot-ai-artificial-intelligence-hello-waving-gif-14586208').setTimestamp().setFooter({ text: 'mychalVidea' });
            await channel.send({ embeds: [startupEmbed] });
        }
    } catch (error) {}

    client.guilds.cache.forEach(guild => { if (guild.id !== allowedGuildId) { guild.leave(); } });
});

client.on('guildCreate', guild => { if (guild.id !== allowedGuildId) { guild.leave(); } });

client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'K této akci nemáš oprávnění.', flags: MessageFlags.Ephemeral });
        }
        const [action, originalMessageId, authorId] = interaction.customId.split('-');
        try {
            const originalMessageUrl = interaction.message.embeds[0].fields[0].value;
            const urlParts = originalMessageUrl.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
            if (!urlParts) throw new Error("Nelze najít původní zprávu z URL.");
            const channelId = urlParts[2];
            const messageId = urlParts[3];
            const channel = await client.channels.fetch(channelId);
            if (!channel) throw new Error("Původní kanál nenalezen.");
            const messageToModerate = await channel.messages.fetch(messageId).catch(() => null);

            if (action === 'approve') {
                const approvedEmbed = new EmbedBuilder(interaction.message.embeds[0].toJSON()).setColor('#00FF00').setTitle('✅ Schváleno Moderátorem').setDescription(`Obrázek od <@${authorId}> byl ponechán.\nSchválil: <@${interaction.user.id}>`);
                await interaction.update({ embeds: [approvedEmbed], components: [] });
            } else if (action === 'punish') {
                await updateRating(authorId, -2, `Nevhodný obrázek (rozhodnutí moderátora)`);
                if (interaction.guild) {
                    await updateRoleStatus(authorId, interaction.guild);
                }
                if (messageToModerate) {
                    await messageToModerate.delete().catch(err => console.log("Nepodařilo se smazat zprávu."));
                    const warningMsg = await channel.send(`<@${authorId}>, tvůj obrázek/GIF byl vyhodnocen jako nevhodný a tvé hodnocení bylo sníženo.`);
                    setTimeout(() => warningMsg.delete().catch(() => {}), 15000);
                }
                const punishedEmbed = new EmbedBuilder(interaction.message.embeds[0].toJSON()).setColor('#FF0000').setTitle('❌ Smazáno a Potrestáno Moderátorem').setDescription(`Obrázek od <@${authorId}> byl smazán a uživatel potrestán.\nModerátor: <@${interaction.user.id}>`);
                await interaction.update({ embeds: [punishedEmbed], components: [] });
            }
        } catch (error) {
            console.error("Chyba při zpracování interakce tlačítka:", error);
            await interaction.reply({ content: 'Došlo k chybě. Zkus to prosím ručně.', flags: MessageFlags.Ephemeral });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;
    const errorEmbed = new EmbedBuilder().setImage(errorGif);
    const ownerId = process.env.OWNER_ID;

    if (commandName === 'list-servers' || commandName === 'leave-server') {
        if (interaction.user.id !== ownerId) { return interaction.reply({ content: 'Tento příkaz může použít pouze majitel bota.', flags: MessageFlags.Ephemeral }); }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (commandName === 'list-servers') {
            const guilds = client.guilds.cache.map(guild => `${guild.name} (ID: ${guild.id})`).join('\n');
            const content = `Bot se nachází na ${client.guilds.cache.size} serverech:\n\n${guilds}`;
            if (content.length > 2000) { const buffer = Buffer.from(content, 'utf-8'); return interaction.editReply({ content: 'Seznam serverů je příliš dlouhý, posílám ho jako soubor.', files: [{ attachment: buffer, name: 'server-list.txt' }] }); }
            return interaction.editReply({ content });
        }
        if (commandName === 'leave-server') {
            const guildId = interaction.options.getString('id');
            const guild = client.guilds.cache.get(guildId);
            if (!guild) { return interaction.editReply({ content: `Chyba: Bot není na žádném serveru s ID \`${guildId}\`.` }); }
            try { await guild.leave(); return interaction.editReply({ content: `✅ Úspěšně jsem opustil server **${guild.name}**.` }); } catch (err) { return interaction.editReply({ content: `❌ Nepodařilo se opustit server. Důvod: ${err.message}` }); }
        }
    }

    if (commandName === 'rate') {
        if (!interaction.member.roles.cache.has(ownerRoleId)) { return interaction.reply({ content: 'K tomuto příkazu má přístup pouze majitel serveru.', flags: MessageFlags.Ephemeral }); }
        await interaction.deferReply();
        const user = interaction.options.getUser('uživatel');
        const rating = interaction.options.getNumber('hodnocení');
        if (user.id === interaction.user.id) { return interaction.editReply({ content: 'Snažíš se sám sobě dát hodnocení, co? 😂', embeds: [errorEmbed] }); }
        if (user.bot) { return interaction.editReply({ content: 'Boti jsou mimo hodnocení, kámo.', embeds: [errorEmbed] }); }
        await updateRating(user.id, rating, `Ručně adminem ${interaction.user.tag}`);
        await updateRoleStatus(user.id, interaction.guild);
        const newAverage = await getAverageRating(user.id);
        await interaction.editReply({ content: `**<@${user.id}>** obdržel(a) nové hodnocení! 🔥 Nový průměr: **\`${newAverage.toFixed(2)} / 10\`**` });
    }

    if (commandName === 'score') {
        const isSelfCheck = !interaction.options.getUser('uživatel');
        await interaction.deferReply({ flags: isSelfCheck ? MessageFlags.Ephemeral : 0 });
        const targetUser = interaction.options.getUser('uživatel') || interaction.user;
        const averageRating = await getAverageRating(targetUser.id);
        const scoreMsg = (targetUser.id === interaction.user.id) ? `🌟 Tvé hodnocení je: **\`${averageRating.toFixed(2)} / 10\`**` : `🌟 Průměrné hodnocení <@${targetUser.id}> je: **\`${averageRating.toFixed(2)} / 10\`**`;
        await interaction.editReply({ content: scoreMsg });
    }

    if (commandName === 'leaderboard') {
        await interaction.deferReply();
        const allRatings = db ? await db.collection('ratings').find({}).sort({ average: -1 }).limit(25).toArray() : [];
        if (allRatings.length === 0) { return interaction.editReply({ content: 'Síň slávy je prázdná!' }); }
        await interaction.guild.members.fetch();
        const scoreEmbed = new EmbedBuilder().setColor('#5865F2').setTitle('✨🏆 SÍŇ SLÁVY 🏆✨').setDescription('Udržuj si skóre nad **9.0** a získáš přístup do 👑 | VIP kanálu pro volání na streamech!\n\n').setTimestamp().setFooter({ text: 'Vaše chování ovlivňuje vaše skóre. Buďte v pohodě! 😉' });
        let leaderboardString = '';
        let rank = 1;
        for (const userData of allRatings) {
            const member = interaction.guild.members.cache.get(userData._id);
            if (!member) continue;
            let roleIndicator = (member.roles.cache.has(roleId)) ? ' 👑' : '';
            let rankDisplay = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `**${rank}.**`;
            leaderboardString += `${rankDisplay} <@${userData._id}> ⮞ \` ${userData.average.toFixed(2)} / 10 \` ${roleIndicator}\n`;
            rank++;
        }
        scoreEmbed.setDescription(scoreEmbed.data.description + leaderboardString);
        await interaction.editReply({ embeds: [scoreEmbed] });
    }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (newMember.roles.cache.has(ownerRoleId)) return;
    const oldTimeoutEnd = oldMember.communicationDisabledUntilTimestamp;
    const newTimeoutEnd = newMember.communicationDisabledUntilTimestamp;
    if (newTimeoutEnd && newTimeoutEnd > Date.now() && newTimeoutEnd !== oldTimeoutEnd) {
        await updateRating(newMember.id, -3, "Důvod: Timeout");
        await updateRoleStatus(newMember.id, newMember.guild, null);
        try {
            const channel = await client.channels.fetch(logChannelId);
            if (channel) channel.send(`Uživatel <@${newMember.id}> dostal timeout a jeho hodnocení bylo sníženo o **3 body**.`);
        } catch (err) {}
    }
});

client.on('guildBanAdd', async (ban) => {
    await resetRating(ban.user.id, "BAN");
    await updateRoleStatus(ban.user.id, ban.guild, null);
    try {
        const channel = await client.channels.fetch(logChannelId);
        if (channel) channel.send(`Uživatel **${ban.user.tag}** dostal BAN a jeho hodnocení bylo resetováno na **0**.`);
    } catch (err) {}
});
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    if (otherBotPrefixes.some(p => message.content.startsWith(p)) || message.content.startsWith(prefix)) return;
    const wasModerated = await moderateMessage(message);
    if (!wasModerated && message.channel.id === activityChannelId) {
        if (!db) return;
        const messageCountsCollection = db.collection('messageCounts');
        const result = await messageCountsCollection.findOneAndUpdate(
            { _id: message.author.id },
            { $inc: { count: 1 }, $setOnInsert: { _id: message.author.id } },
            { upsert: true, returnDocument: 'after' }
        );
        const userMessageCount = result ? result.count : 1;
        if (userMessageCount >= 10) {
            await addActivityRating(message.author.id, "Aktivita");
            await updateRoleStatus(message.author.id, message.guild, message);
            await messageCountsCollection.updateOne({ _id: message.author.id }, { $set: { count: 0 } });
        }
    }
});
client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (newMessage.partial) { try { await newMessage.fetch(); } catch { return; } }
    if (newMessage.author.bot || !newMessage.guild) return;
    if (oldMessage.content === newMessage.content) return;
    await moderateMessage(newMessage);
});

client.login(process.env.BOT_TOKEN);
