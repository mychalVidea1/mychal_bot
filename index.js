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

let ratings = {};
try {
    const data = fs.readFileSync('ratings.json', 'utf8');
    ratings = JSON.parse(data);
} catch (err) {
    console.log('Soubor s hodnocením nebyl nalezen, bude vytvořen nový.');
}

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
        if (!user) return message.channel.send('Musíš označit uživatele. Formát: `m!rate [@user] [hodnocení]`');
        
        const rating = parseInt(args[1]);
        if (isNaN(rating) || rating < 0 || rating > 10) return message.channel.send('Hodnocení musí být číslo od 0 do 10.');
        
        if (!ratings[user.id]) ratings[user.id] = [];
        ratings[user.id].push(rating);
        saveRatings();
        
        const userRatings = ratings[user.id];
        const averageRating = userRatings.reduce((a, b) => a + b, 0) / userRatings.length;
        
        message.channel.send(`<@${user.id}> -> ${averageRating.toFixed(2)} | Dostal hodnocení: ${rating}`);

        // =========================================================
        // VYLEPŠENÁ A ODOLNĚJŠÍ LOGIKA PRO SPRÁVU ROLÍ
        // =========================================================
        try {
            console.log(`[LOG] Průměrné hodnocení pro ${user.tag} je ${averageRating.toFixed(2)}.`);

            // Použijeme .fetch() pro jistotu, že dostaneme aktuálního člena, i když není v cache
            const member = await message.guild.members.fetch(user.id);
            if (!member) {
                console.error(`[CHYBA] Nepodařilo se najít člena serveru pro ID: ${user.id}`);
                return;
            }
            console.log(`[LOG] Člen serveru ${member.user.tag} nalezen.`);

            // Získání role
            const role = message.guild.roles.cache.get(roleId);
            if (!role) {
                console.error(`[CHYBA] Role s ID ${roleId} nebyla na serveru nalezena. Zkontrolujte proměnnou ROLE_ID na Railway a jestli role existuje.`);
                return;
            }
            console.log(`[LOG] Role "${role.name}" nalezena.`);

            const hasRole = member.roles.cache.has(role.id);
            console.log(`[LOG] Má uživatel roli? ${hasRole ? 'Ano' : 'Ne'}`);

            if (averageRating > 9) {
                console.log('[LOG] Podmínka pro přidání role (rating > 9) je splněna.');
                if (!hasRole) {
                    console.log(`[LOG] Pokouším se přidat roli "${role.name}" uživateli ${member.user.tag}...`);
                    await member.roles.add(role);
                    console.log(`[LOG] Role byla úspěšně přidělena.`);
                    message.channel.send(`Gratuluji, <@${member.id}>! Díky vysokému hodnocení jsi získal(a) roli **${role.name}**.`);
                }
            } else {
                console.log('[LOG] Podmínka pro odebrání role (rating <= 9) je splněna.');
                if (hasRole) {
                    console.log(`[LOG] Pokouším se odebrat roli "${role.name}" uživateli ${member.user.tag}...`);
                    await member.roles.remove(role);
                    console.log(`[LOG] Role byla úspěšně odebrána.`);
                    message.channel.send(`Škoda, <@${member.id}>. Tvé hodnocení kleslo, proto ti byla odebrána role **${role.name}**.`);
                }
            }
        } catch (error) {
            console.error('[ZÁVAŽNÁ CHYBA] Došlo k chybě při správě rolí:', error);
            message.channel.send('Při správě rolí došlo k chybě. Nejspíše mi chybí oprávnění nebo je má role příliš nízko. Zkontrolujte prosím logy.');
        }
    }

    if (command === 'score') {
        // ... (kód pro score zůstává stejný)
        if (message.mentions.everyone) {
            const userIds = Object.keys(ratings);
            if (userIds.length === 0) return message.channel.send('Zatím nikdo nebyl hodnocen.');
            
            userIds.sort((a, b) => {
                const avgA = ratings[a].reduce((sum, r) => sum + r, 0) / ratings[a].length;
                const avgB = ratings[b].reduce((sum, r) => sum + r, 0) / ratings[b].length;
                return avgB - avgA;
            });

            const scoreEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Průměrné hodnocení všech uživatelů')
                .setTimestamp();
            
            let description = '';
            userIds.forEach(userId => {
                const userRatings = ratings[userId];
                const averageRating = userRatings.reduce((a, b) => a + b, 0) / userRatings.length;
                description += `<@${userId}>: **${averageRating.toFixed(2)}** / 10 (${userRatings.length} hodnocení)\n`;
            });
            scoreEmbed.setDescription(description);
            return message.channel.send({ embeds: [scoreEmbed] });
        }
        
        const user = message.mentions.users.first();
        if (!user) return message.channel.send('Musíš označit uživatele nebo použít `@everyone`.');
        
        const userRatings = ratings[user.id];
        if (!userRatings || userRatings.length === 0) return message.channel.send(`Uživatel <@${user.id}> ještě nemá žádné hodnocení.`);
        
        const averageRating = userRatings.reduce((a, b) => a + b, 0) / userRatings.length;
        return message.channel.send(`Uživatel <@${user.id}> má průměrné hodnocení: **${averageRating.toFixed(2)}** / 10`);
    }
});

client.login(process.env.BOT_TOKEN);
