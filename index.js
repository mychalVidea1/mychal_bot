require('dotenv').config();

const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
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

// ===== ZMĚNA ZAČÍNÁ ZDE =====
// 1. Definujeme cestu k souboru v permanentním úložišti (Volume)
const ratingsFilePath = '/data/ratings.json';

let ratings = {};
try {
    // 2. Čteme soubor z nové, permanentní cesty
    const data = fs.readFileSync(ratingsFilePath, 'utf8');
    ratings = JSON.parse(data);
    console.log('Hodnocení úspěšně načteno z permanentního úložiště.');
} catch (err) {
    // Pokud soubor neexistuje, nevadí, vytvoří se při prvním hodnocení
    console.log('Soubor s hodnocením nebyl v permanentním úložišti nalezen, bude vytvořen nový.');
}

function saveRatings() {
    try {
        // 3. Ukládáme soubor na novou, permanentní cestu
        fs.writeFileSync(ratingsFilePath, JSON.stringify(ratings, null, 2));
        console.log('Hodnocení bylo úspěšně uloženo do permanentního úložiště.');
    } catch (err) {
        console.error('CHYBA: Nepodařilo se uložit hodnocení do permanentního úložiště!', err);
    }
}
// ===== ZMĚNA KONČÍ ZDE =====


client.once('ready', () => {
    console.log(`Bot je online jako ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
    if (!message.content.startsWith(prefix) || message.author.bot) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'rate') {
        const user = message.mentions.users.first();
        if (!user) return message.channel.send('Musíš označit uživatele. Formát: `m!rate [@user] [hodnocení]`');
        
        const rating = parseInt(args[1]);
        if (isNaN(rating) || rating < 0 || rating > 10) return message.channel.send('Hodnocení musí být číslo od 0 do 10.');
        
        if (!ratings[user.id]) ratings[user.id] = [];
        ratings[user.id].push(rating);
        saveRatings(); // Tato funkce nyní ukládá do Volume
        
        const userRatings = ratings[user.id];
        const averageRating = userRatings.reduce((a, b) => a + b, 0) / userRatings.length;
        
        message.channel.send(`<@${user.id}> -> ${averageRating.toFixed(2)} | Dostal hodnocení: ${rating}`);
        
        try {
            const member = await message.guild.members.fetch(user.id);
            const role = message.guild.roles.cache.get(roleId);

            if (!member || !role) {
                console.error('Nepodařilo se najít člena nebo roli. Zkontrolujte ID role.');
                return;
            }

            if (averageRating > 9) {
                if (!member.roles.cache.has(role.id)) {
                    await member.roles.add(role);
                    message.channel.send(`Gratuluji, <@${member.id}>! Díky vysokému hodnocení jsi získal(a) roli **${role.name}**.`);
                }
            } else {
                if (member.roles.cache.has(role.id)) {
                    await member.roles.remove(role);
                    message.channel.send(`Škoda, <@${member.id}>. Tvé hodnocení kleslo, proto ti byla odebrána role **${role.name}**.`);
                }
            }
        } catch (error) {
            console.error('Došlo k chybě při správě rolí:', error);
        }
    }

    if (command === 'score') {
        if (message.mentions.everyone) {
            const userIds = Object.keys(ratings);

            if (userIds.length === 0) {
                return message.channel.send('Zatím nikdo nebyl hodnocen.');
            }

            userIds.sort((a, b) => {
                const avgA = ratings[a].reduce((sum, r) => sum + r, 0) / ratings[a].length;
                const avgB = ratings[b].reduce((sum, r) => sum + r, 0) / ratings[b].length;
                return avgB - avgA;
            });

            const scoreEmbed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('🏆 Průměrné hodnocení všech uživatelů')
                .setTimestamp();
            
            let description = '';
            for (const userId of userIds) {
                const userRatings = ratings[userId];
                const averageRating = userRatings.reduce((a, b) => a + b, 0) / userRatings.length;
                
                let roleIndicator = '';
                try {
                    const member = await message.guild.members.fetch(userId);
                    if (member && member.roles.cache.has(roleId)) {
                        roleIndicator = ' 🏆';
                    }
                } catch (error) {
                    console.log(`Nepodařilo se načíst člena ${userId}, pravděpodobně opustil server.`);
                }
                
                description += `<@${userId}>: **${averageRating.toFixed(2)}** / 10 (${userRatings.length} hodnocení)${roleIndicator}\n`;
            }

            if (description.length > 4096) {
                description = description.substring(0, 4090) + '...';
            }

            scoreEmbed.setDescription(description);
            return message.channel.send({ embeds: [scoreEmbed] });
        }

        const user = message.mentions.users.first();
        if (!user) {
            return message.channel.send('Musíš označit uživatele nebo použít `@everyone`. Formát: `m!score [@user]` nebo `m!score @everyone`');
        }

        const userRatings = ratings[user.id];
        if (!userRatings || userRatings.length === 0) {
            return message.channel.send(`Uživatel <@${user.id}> ještě nemá žádné hodnocení.`);
        }

        const averageRating = userRatings.reduce((a, b) => a + b, 0) / userRatings.length;
        return message.channel.send(`Uživatel <@${user.id}> má průměrné hodnocení: **${averageRating.toFixed(2)}** / 10`);
    }

});

client.login(process.env.BOT_TOKEN);
