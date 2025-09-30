require('dotenv').config();
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

const token = process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

const rest = new REST({ version: '10' }).setToken(token);

console.log(`Zahajuji mazání příkazů na serveru s ID: ${guildId}`);

rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] })
    .then(() => console.log('✅ Úspěšně smazány staré serverové příkazy.'))
    .catch(console.error);