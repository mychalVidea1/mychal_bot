require('dotenv').config();

const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.Channel, Partials.GuildMember]
});

// ======================= NASTAVENÍ =======================
const prefix = 'm!';
const roleId = process.env.ROLE_ID;
const errorGif = 'https://tenor.com/view/womp-womp-gif-9875106689398845891';

const ownerRoleId = '875091178322812988';
const activityChannelId = '875097279650992128';
const filterWhitelistChannelId = '875093420090216499';
const startupChannelId = '1025689879973203968';

const nWords = [
    'nigga', 'n1gga', 'n*gga', 'niggas', 'nigger', 'n1gger', 'n*gger', 'niggers',
    'niga', 'n1ga', 'nygga', 'niggar', 'negr', 'ne*r', 'n*gr', 'n3gr', 'neger', 'negri'
];
const inappropriateWords = [
    'kurva', 'kurvo', 'kurvy', 'kunda', 'píča', 'pica', 'píčo', 'pico', 'pičo',
    'kokot', 'kokote', 'kkt', 'čurák', 'curak', 'čůrák', 'mrdka', 'mrd', 'šukat', 'mrdat',
    'debil', 'blbec', 'idiot', 'zmrd', 'hajzl', 'hovno', 'kretén', 'magor', 'buzerant',
    'fuck', 'f*ck', 'fck', 'fuk', 'shit', 'sh*t', 'sht', 'bitch', 'b*tch',
    'cunt', 'c*nt', 'asshole', 'assh*le', 'bastard', 'motherfucker', 'mf', 'dick', 'pussy', 'faggot'
];
// ==============================================================================

const dataDirectory = '/data';
const ratingsFilePath = `${dataDirectory}/ratings.json`;
const messageCountsFilePath = `${dataDirectory}/message_counts.json`;

if (!fs.existsSync(dataDirectory)) fs.mkdirSync(dataDirectory);

let ratings = {};
try { ratings = JSON.parse(fs.readFileSync(ratingsFilePath, 'utf8')); } 
catch (err) { console.log('Soubor s hodnocením nebyl nalezen.'); }

let messageCounts = {};
try { messageCounts = JSON.parse(fs.readFileSync(messageCountsFilePath, 'utf8')); } 
catch (err) { console.log('Soubor s počtem zpráv nebyl nalezen.'); }

function saveRatings() {
    try { fs.writeFileSync(ratingsFilePath, JSON.stringify(ratings, null, 2)); } 
    catch (err) { console.error('CHYBA: Nepodařilo se uložit hodnocení!', err); }
}

function saveMessageCounts() {
    try { fs.writeFileSync(messageCountsFilePath, JSON.stringify(messageCounts, null, 2)); } 
    catch (err) { console.error('CHYBA: Nepodařilo se uložit počty zpráv!', err); }
}

function calculateAverage(userId) {
    const userRatings = ratings[userId] || [];
    if (userRatings.length === 0) return 5.0;
    let average = userRatings.reduce((a, b) => a + b, 0) / userRatings.length;
    return Math.max(0, Math.min(10, average));
}

function addRating(userId, rating, reason = "") {
    if (!ratings[userId]) ratings[userId] = [];
    ratings[userId].push(rating);
    if (ratings[userId].length > 10) ratings[userId].shift();
    saveRatings();
    console.log(`Uživatel ${userId} dostal hodnocení ${rating}. ${reason}`);
}

function cleanupOldRatings() {
    let changed = false;
    for (const userId in ratings) {
        if (ratings[userId].length > 10) {
            ratings[userId] = ratings[userId].slice(-10);
            changed = true;
        }
    }
    if (changed) saveRatings();
}
cleanupOldRatings();

client.once('clientReady', async () => {
    console.log(`Bot je online jako ${client.user.tag}!`);
    try {
        const channel = await client.channels.fetch(startupChannelId);
        if (channel) {
            const startupEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('🚀 JSEM ZPÁTKY ONLINE! 🚀')
                .setDescription('Systémy nastartovány, databáze pročištěna. Jsem připraven hodnotit vaše chování, kulišáci! 👀')
                .setImage('https://tenor.com/view/robot-ai-artificial-intelligence-hello-waving-gif-14586208')
                .setTimestamp()
                .setFooter({ text: 'mychalVidea' });
            await channel.send({ embeds: [startupEmbed] });
        }
    } catch (error) { console.error(`Nepodařilo se odeslat startup zprávu. Chyba:`, error); }
});

client.on('guildMemberUpdate', (oldMember, newMember) => {
    if (newMember.roles.cache.has(ownerRoleId)) return;
    const oldTimeout = oldMember.communicationDisabledUntilTimestamp;
    const newTimeout = newMember.communicationDisabledUntilTimestamp;
    if ((!oldTimeout && newTimeout) || (newTimeout > oldTimeout)) {
        addRating(newMember.id, -3, "Důvod: Timeout");
        const channel = newMember.guild.systemChannel;
        if(channel) channel.send(`Uživatel <@${newMember.id}> dostal timeout a jeho hodnocení bylo sníženo o **3 body**.`);
    }
});

client.on('guildBanAdd', async (ban) => {
    ratings[ban.user.id] = [0];
    saveRatings();
    const channel = ban.guild.systemChannel;
    if(channel) channel.send(`Uživatel **${ban.user.tag}** dostal BAN a jeho hodnocení bylo resetováno na **0**.`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (!message.content.startsWith(prefix)) {
        if (message.channel.id === filterWhitelistChannelId) return;
        if (message.member && message.member.roles.cache.has(ownerRoleId)) return;

        const messageContent = message.content.toLowerCase().replace(/\s/g, '');
        if (nWords.some(word => messageContent.includes(word))) {
            ratings[message.author.id] = [0];
            saveRatings();
            try {
                await message.delete();
                const warningMsg = await message.channel.send(`Uživatel <@${message.author.id}> použil zakázané slovo. Jeho hodnocení bylo **resetováno na 0**.`);
                setTimeout(() => warningMsg.delete().catch(() => {}), 15000);
            } catch (err) { console.error("Chybí mi oprávnění 'Spravovat zprávy'."); }
            return;
        }
        
        if (inappropriateWords.some(word => messageContent.includes(word))) {
            addRating(message.author.id, -1, "Důvod: Nevhodné slovo");
            try {
                await message.delete();
                const warningMsg = await message.channel.send(`<@${message.author.id}>, za nevhodné chování ti byl snížen rating o **1 bod**.`);
                setTimeout(() => warningMsg.delete().catch(() => {}), 10000);
            } catch (err) { console.error("Chybí mi oprávnění 'Spravovat zprávy'."); }
            return;
        }

        if (message.channel.id === activityChannelId) {
            if (!messageCounts[message.author.id]) messageCounts[message.author.id] = 0;
            messageCounts[message.author.id]++;
            if (messageCounts[message.author.id] >= 10) {
                if (!ratings[message.author.id] || ratings[message.author.id].length === 0) {
                    addRating(message.author.id, 5, "Důvod: První odměna za aktivitu");
                    const activityMsg = await message.channel.send(`*<@${message.author.id}>, díky za aktivitu! Získáváš své první body do hodnocení.*`);
                    setTimeout(() => activityMsg.delete().catch(() => {}), 7000);
                } else {
                    addRating(message.author.id, 10, "Důvod: Aktivita");
                }
                messageCounts[message.author.id] = 0;
            }
            saveMessageCounts();
        }
        return; 
    }

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'rate') {
        try { await message.delete(); } 
        catch (err) { console.error("Chyba při mazání příkazu (rate): Chybí mi oprávnění 'Spravovat zprávy'."); }

        const errorEmbed = new EmbedBuilder().setImage(errorGif);
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            const reply = await message.channel.send({ content: 'Na tohle nemáš oprávnění, kámo. ✋ Jen pro adminy.', embeds: [errorEmbed] });
            setTimeout(() => reply.delete().catch(() => {}), 10000);
            return;
        }
        
        const user = message.mentions.users.first();
        if (!user) {
            const reply = await message.channel.send({ content: 'Bruh, koho mám jako hodnotit? Musíš někoho @označit! 🤔', embeds: [errorEmbed] });
            setTimeout(() => reply.delete().catch(() => {}), 10000);
            return;
        }
        
        if (user.id === message.author.id) {
            const reply = await message.channel.send({ content: 'Snažíš se sám sobě dát 10/10, co? Hezký pokus, ale takhle to nefunguje. 😂', embeds: [errorEmbed] });
            setTimeout(() => reply.delete().catch(() => {}), 10000);
            return;
        }
        
        const rating = parseFloat(args[1]); 
        if (isNaN(rating) || rating < -10 || rating > 10) {
            const reply = await message.channel.send({ content: 'Stupnice je -10 až 10, bro. Ani víc, ani míň. 🔢', embeds: [errorEmbed] });
            setTimeout(() => reply.delete().catch(() => {}), 10000);
            return;
        }
        
        addRating(user.id, rating, `Ručně adminem ${message.author.tag}`);
        const averageRating = calculateAverage(user.id);
        
        const reply = await message.channel.send(`**<@${user.id}>** obdržel(a) nové hodnocení! 🔥 Průměr: **\`${averageRating.toFixed(2)} / 10\`**`);
        setTimeout(() => reply.delete().catch(() => {}), 20000);

        try {
            if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return;
            const member = await message.guild.members.fetch(user.id);
            const role = message.guild.roles.cache.get(roleId);
            if (!member || !role) return;
            if (averageRating > 9) {
                if (!member.roles.cache.has(role.id)) await member.roles.add(role);
            } else {
                if (member.roles.cache.has(role.id)) await member.roles.remove(role);
            }
        } catch (error) { console.error('Došlo k chybě při správě rolí:', error); }
    }

    if (command === 'score') {
        if (message.mentions.everyone) {
            try { await message.delete(); } 
            catch (err) { console.error("Chyba při mazání příkazu (score @everyone): Chybí mi oprávnění 'Spravovat zprávy'."); }

            const userIds = Object.keys(ratings);
            if (userIds.length === 0) return message.channel.send({ content: 'Síň slávy je prázdná!', embeds: [new EmbedBuilder().setImage(errorGif)] });
            
            userIds.sort((a, b) => calculateAverage(b) - calculateAverage(a));

            const scoreEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('✨🏆 SÍŇ SLÁVY 🏆✨')
                .setDescription('Udržuj si skóre nad **9.0** a získáš přístup do 👑 | VIP kanálu pro volání na streamech!\n\n')
                .setTimestamp()
                .setFooter({ text: 'Vaše chování ovlivňuje vaše skóre. Buďte v pohodě! 😉' });
            let leaderboardString = '';
            let rank = 1;
            for (const userId of userIds) {
                const averageRating = calculateAverage(userId);
                if (!ratings[userId] || ratings[userId].length === 0) continue;
                let roleIndicator = '';
                try {
                    const member = await message.guild.members.fetch(userId);
                    if (member && member.roles.cache.has(roleId)) roleIndicator = ' 👑';
                } catch (error) {}
                let rankDisplay;
                if (rank === 1) rankDisplay = '🥇';
                else if (rank === 2) rankDisplay = '🥈';
                else if (rank === 3) rankDisplay = '🥉';
                else rankDisplay = `**${rank}.**`;
                leaderboardString += `${rankDisplay} <@${userId}> ⮞ \` ${averageRating.toFixed(2)} / 10 \` ${roleIndicator}\n`;
                rank++;
            }
            scoreEmbed.setDescription(scoreEmbed.data.description + leaderboardString);
            return message.channel.send({ embeds: [scoreEmbed] });
        }
        
        try { await message.delete(); } 
        catch (err) { console.error("Chyba při mazání příkazu (score): Chybí mi oprávnění 'Spravovat zprávy'."); }

        const errorEmbed = new EmbedBuilder().setImage(errorGif);
        const targetUser = message.mentions.users.first() || message.author;
        
        const userRatings = ratings[targetUser.id] || [];
        if (userRatings.length === 0) {
            let errorMsg;
            if (targetUser.id === message.author.id) errorMsg = 'Zatím nemáš žádné hodnocení, kámo! 🤷';
            else errorMsg = `Uživatel <@${targetUser.id}> je zatím nepopsaný list. 📜`;
            
            const reply = await message.channel.send({ content: errorMsg, embeds: [errorEmbed] });
            setTimeout(() => reply.delete().catch(() => {}), 10000);
            return;
        }
        
        const averageRating = calculateAverage(targetUser.id);
        
        let scoreMsg;
        if (targetUser.id === message.author.id) {
            scoreMsg = `🌟 <@${targetUser.id}> Tvé průměrné hodnocení je: **\`${averageRating.toFixed(2)} / 10\`**`;
        } else {
            scoreMsg = `🌟 Průměrné hodnocení uživatele <@${targetUser.id}> je: **\`${averageRating.toFixed(2)} / 10\`**`;
        }

        const reply = await message.channel.send(scoreMsg);
        setTimeout(() => reply.delete().catch(() => {}), 10000);
    }
});

client.login(process.env.BOT_TOKEN);
