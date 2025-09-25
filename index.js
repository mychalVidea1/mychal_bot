const { REST, Routes } = require('discord.js');
require('dotenv').config();

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

// Vymaže příkazy pro konkrétní server
rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [] })
    .then(() => console.log('Successfully deleted all guild commands.'))
    .catch(console.error);

// Případně vymaže globální příkazy (pokud byly použity)
rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] })
    .then(() => console.log('Successfully deleted all application commands.'))
    .catch(console.error);
