require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

// Vytvoříme jen minimálního klienta, který se dokáže přihlásit
const client = new Client({ intents: [] });

// Jakmile se bot připojí k Discordu, provede tuto jednorázovou akci
client.once('clientReady', async () => {
    console.log(`Bot ${client.user.tag} se dočasně připojil.`);
    console.log('Zahajuji jednorázový úklid GLOBÁLNÍCH příkazů...');

    try {
        const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

        // Tento příkaz smaže VŠECHNY globální příkazy pro tvého bota
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: [] }, // Posíláme prázdné pole, což znamená "smazat vše"
        );

        console.log('✅ Úspěšně smazáno. Globální příkazy jsou pryč.');
        console.log('Bot se nyní vypne. Můžeš vrátit zpět svůj původní kód.');

    } catch (error) {
        console.error('❌ Nepodařilo se smazat globální příkazy:', error);
    } finally {
        // Vypneme proces, ať už uspěl nebo ne
        client.destroy();
        process.exit(0);
    }
});

// Přihlášení bota
console.log("Spouštím dočasný úklidový skript...");
client.login(process.env.BOT_TOKEN);
