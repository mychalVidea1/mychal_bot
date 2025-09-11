const { Client, GatewayIntentBits, Partials } = require("discord.js");
const express = require("express");
const path = require('path');
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,      // pro čtení zpráv
    GatewayIntentBits.MessageContent      // pro obsah zpráv
  ],
});

const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const GUILD_ID = process.env.GUILD_ID;

app.get("/members", async (req, res) => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetch();
    const members = guild.members.cache.map(m => ({
      id: m.id,
      username: m.user.username,
      discriminator: m.user.discriminator,
      roles: m.roles.cache.map(r => r.id)
    }));
    res.json(members);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Chyba při načítání členů" });
  }
});

app.listen(PORT, () => console.log(`Web API běží na portu ${PORT}`));

client.once("ready", () => {
  console.log(`Bot online jako ${client.user.tag}`);
});

// --- PŘÍKAZ ---
client.on('messageCreate', message => {
  if (message.content.toLowerCase() === 'm! sac') {
    message.channel.send('🍀 SAC MYCHAL 🍀');
  }
});

client.login(TOKEN).catch(err => console.error("Chyba při loginu bota:", err));
