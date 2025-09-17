require('dotenv').config();

const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel]
});

const prefix = 'm!';
const roleId = process.env.ROLE_ID;

const errorGif = 'https://tenor.com/view/womp-womp-gif-9875106689398845891';

const dataDirectory = '/data';
const ratingsFilePath = `${dataDirectory}/ratings.json`;

if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory);
    console.log(`Úspěšně vytvořena permanentní složka: ${dataDirectory}`);
}

let ratings = {};
try {
    const data = fs.readFileSync(ratingsFilePath, 'utf8');
    ratings = JSON.parse(data);
    console.log('Hodnocení úspěšně načteno z permanentního úložiště.');
} catch (err) {
    console.log('Soubor s hodnocení nebyl v permanentním úložišti nalezen, bude vytvořen nový.');
}

function saveRatings() {
    try {
        fs.writeFileSync(ratingsFilePath, JSON.stringify(ratings, null, 2));
        console.log('Hodnocení bylo úspěšně uloženo do permanentního úložiště.');
    } catch (err) {
        console.error('CHYBA: Nepodařilo se uložit hodnocení do permanentního úložiště!', err);
    }
}

function cleanupOldRatings() {
    let changed = false;
    for (const userId in ratings) {
        if (ratings[userId].length > 10) {
            ratings[userId] = ratings[userId].slice(-10);
            console.log(`Pročištěna data pro uživatele ${userId}. Ponecháno 10 nejnovějších hodnocení.`);
            changed = true;
        }
    }
    if (changed) {
        saveRatings();
    }
}

cleanupOldRatings();

client.once('clientReady', () => {
    console.log(`Bot je online jako ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
    if (!message.content.startsWith(prefix) || message.author.bot) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ===== ZMĚNA ZDE: VŠECHNY CHYBOVÉ ZPRÁVY NYNÍ POUŽÍVAJÍ EMBED PRO GIF =====
    if (command === 'rate') {
        const errorEmbed = new EmbedBuilder().setImage(errorGif);

        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.channel.send({ content: 'Na tohle nemáš oprávnění, kámo. ✋ Jen pro adminy.', embeds: [errorEmbed] });
        }

        const user = message.mentions.users.first();
        if (!user) return message.channel.send({ content: 'Bruh, koho mám jako hodnotit? Musíš někoho @označit! 🤔', embeds: [errorEmbed] });
        
        if (user.id === message.author.id) {
            return message.channel.send({ content: 'Snažíš se sám sobě dát 10/10, co? Hezký pokus, ale takhle to nefunguje. 😂', embeds: [errorEmbed] });
        }
        
        const rating = parseInt(args[1]);
        if (isNaN(rating) || rating < 0 || rating > 10) return message.channel.send({ content: 'Stupnice je 0-10, bro. Ani víc, ani míň. 🔢', embeds: [errorEmbed] });
        
        if (!ratings[user.id]) ratings[user.id] = [];
        
        ratings[user.id].push(rating);
        
        if (ratings[user.id].length > 10) {
            ratings[user.id].shift();
        }
        
        saveRatings();
        
        const userRatings = ratings[user.id];
        const averageRating = userRatings.reduce((a, b) => a + b, 0) / userRatings.length;
        
        message.channel.send(`**<@${user.id}>** obdržel(a) nové hodnocení! 🔥 Průměr: **\`${averageRating.toFixed(2)} / 10\`**`);
        
        try {
            if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                return message.channel.send({ content: "Chyba: Nemám oprávnění spravovat role. Prosím, zkontroluj má oprávnění.", embeds: [errorEmbed] });
            }
            
            const member = await message.guild.members.fetch(user.id);
            const role = message.guild.roles.cache.get(roleId);

            if (!member || !role) return;

            if (averageRating > 9) {
                if (!member.roles.cache.has(role.id)) {
                    await member.roles.add(role);
                    message.channel.send(`🎉 Gratulace, <@${member.id}>! Tvé skóre tě katapultovalo mezi elitu a získal(a) jsi roli **${role.name}**! 🚀`);
                }
            } else {
                if (member.roles.cache.has(role.id)) {
                    await member.roles.remove(role);
                    message.channel.send(`📉 Pozor, <@${member.id}>! Tvé hodnocení kleslo a přišel(a) jsi o roli **${role.name}**. Zaber!`);
                }
            }
        } catch (error) {
            console.error('Došlo k chybě při správě rolí:', error);
            message.channel.send('Při správě rolí došlo k neočekávané chybě. Pravděpodobně je má role příliš nízko.');
        }
    }

    if (command === 'score') {
        const errorEmbed = new EmbedBuilder().setImage(errorGif);

        if (message.mentions.everyone) {
            const userIds = Object.keys(ratings);

            if (userIds.length === 0) return message.channel.send({ content: 'Zatím nikdo nebyl hodnocen, síň slávy je prázdná! 텅텅', embeds: [errorEmbed] });

            userIds.sort((a, b) => {
                const avgA = ratings[a].reduce((sum, r) => sum + r, 0) / ratings[a].length;
                const avgB = ratings[b].reduce((sum, r) => sum + r, 0) / ratings[b].length;
                return avgB - avgA;
            });
            
            const scoreEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('✨🏆 SÍŇ SLÁVY 🏆✨')
                .setDescription('Udržuj si skóre nad **9.0** a získáš přístup do 👑 | VIP kanálu pro volání na streamech!\n\n')
                .setTimestamp()
                .setFooter({ text: 'Vaše chování ovlivňuje vaše skóre. Buďte v pohodě! 😉' });
            
            let leaderboardString = '';
            let rank = 1;
            for (const userId of userIds) {
                const userRatings = ratings[userId];
                const averageRating = userRatings.reduce((a, b) => a + b, 0) / userRatings.length;
                
                let roleIndicator = '';
                try {
                    const member = await message.guild.members.fetch(userId);
                    if (member && member.roles.cache.has(roleId)) {
                        roleIndicator = ' 👑';
                    }
                } catch (error) { /* Ignorujeme chyby */ }

                let rankDisplay;
                if (rank === 1) rankDisplay = '🥇';
                else if (rank === 2) rankDisplay = '🥈';
                else if (rank === 3) rankDisplay = '🥉';
                else rankDisplay = `**${rank}.**`;
                
                leaderboardString += `${rankDisplay} <@${userId}> ⮞ \` ${averageRating.toFixed(2)} / 10 \` ${roleIndicator}\n`;
                rank++;
            }

            if (leaderboardString.length > 3000) {
                leaderboardString = leaderboardString.substring(0, 2990) + '...';
            }
            
            scoreEmbed.setDescription(scoreEmbed.data.description + leaderboardString);
            
            return message.channel.send({ embeds: [scoreEmbed] });
        }
        
        const targetUser = message.mentions.users.first() || message.author;

        const userRatings = ratings[targetUser.id];
        if (!userRatings || userRatings.length === 0) {
            if (targetUser.id === message.author.id) {
                return message.channel.send({ content: 'Zatím nemáš žádné hodnocení, kámo! 🤷', embeds: [errorEmbed] });
            } else {
                return message.channel.send({ content: `Uživatel <@${targetUser.id}> je zatím nepopsaný list. 📜`, embeds: [errorEmbed] });
            }
        }

        const averageRating = userRatings.reduce((a, b) => a + b, 0) / userRatings.length;
        
        if (targetUser.id === message.author.id) {
            return message.channel.send(`🌟 Tvé průměrné hodnocení je: **\`${averageRating.toFixed(2)} / 10\`**`);
        } else {
            return message.channel.send(`🌟 Průměrné hodnocení uživatele <@${targetUser.id}> je: **\`${averageRating.toFixed(2)} / 10\`**`);
        }
    }
});

client.login(process.env.BOT_TOKEN);
