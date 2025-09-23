require('dotenv').config();
const { REST, Routes } = require('discord.js');

// Načtení proměnných z .env souboru
const { BOT_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

// Kontrola, zda jsou všechny potřebné proměnné nastaveny
if (!BOT_TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error('Chyba: Ujistěte se, že BOT_TOKEN, CLIENT_ID a GUILD_ID jsou nastaveny v souboru .env!');
    process.exit(1); // Ukončí skript, pokud něco chybí
}

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

async function clearCommands() {
    try {
        console.log('Zahajuji proces mazání všech starých aplikačních (/) příkazů...');

        // Odeslání prázdného pole do API přepíše (a tím smaže) všechny existující příkazy pro daný server.
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: [] }, // Prázdné pole znamená "žádné příkazy"
        );

        console.log('✅ Úspěšně smazány všechny aplikační příkazy na serveru.');
        console.log('Nyní můžete spustit svého hlavního bota (index.js).');

    } catch (error) {
        console.error('❌ Došlo k chybě při mazání příkazů:', error);
    }
}

// Spuštění funkce
clearCommands();
