// Na začátek souboru přidejte tento řádek
require('dotenv').config();

const { Client, GatewayIntentBits, Partials } = require('discord.js');
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
// Načtení ID role z environmentálních proměnných
const roleId = process.env.ROLE_ID;

// Načtení hodnocení z JSON souboru při startu
let ratings = {};
try {
    const data = fs.readFileSync('ratings.json', 'utf8');
    ratings = JSON.parse(data);
} catch (err) {
    console.log('Soubor s hodnocením nebyl nalezen, bude vytvořen nový.');
}

// Funkce pro uložení hodnocení do JSON souboru
function saveRatings() {
    fs.writeFileSync('ratings.json', JSON.stringify(ratings, null, 2), (err) => {
        if (err) console.error('Chyba při ukládání hodnocení:', err);
    });
}

client.once('ready', () => {
    console.log(`Bot je online jako ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
    if (!message.content.startsWith(prefix) || message.author.bot) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'rate') {
        const user = message.mentions.users.first();
        if (!user) {
            return message.channel.send('Musíš označit uživatele, kterého chceš ohodnotit. Formát: `m!rate [@user] [hodnocení]`');
        }

        const rating = parseInt(args[1]);
        if (isNaN(rating) || rating < 0 || rating > 10) {
            return message.channel.send('Hodnocení musí být číslo od 0 do 10.');
        }

        if (!ratings[user.id]) {
            ratings[user.id] = [];
        }
        ratings[user.id].push(rating);
        saveRatings();

        const userRatings = ratings[user.id];
        const averageRating = userRatings.reduce((a, b) => a + b, 0) / userRatings.length;

        message.channel.send(`<@${user.id}> -> ${averageRating.toFixed(2)} | Dostal hodnocení: ${rating}`);

        const member = message.guild.members.cache.get(user.id);
        const role = message.guild.roles.cache.get(roleId);

        if (!member || !role) {
            console.error('Nepodařilo se najít člena nebo roli. Zkontrolujte ID role.');
            return;
        }

        if (averageRating > 9) {
            if (!member.roles.cache.has(role.id)) {
                member.roles.add(role)
                    .then(() => console.log(`Role byla přidělena uživateli ${user.tag}.`))
                    .catch(console.error);
            }
        } else {
            if (member.roles.cache.has(role.id)) {
                member.roles.remove(role)
                    .then(() => console.log(`Role byla odebrána uživateli ${user.tag}.`))
                    .catch(console.error);
            }
        }
    }
});

// Načtení tokenu z environmentálních proměnných
client.login(process.env.BOT_TOKEN);
