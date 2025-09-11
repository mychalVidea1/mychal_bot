const { Client, GatewayIntentBits } = require("discord.js");
const express = require("express");
const path = require('path');

const app = express();
app.use(express.json());

// Servíruje frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Discord bot
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const PORT = process.env.PORT || 3000;

// API members
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

// API pro rating/verified
app.post('/rate', async (req, res) => {
  const { memberId } = req.body;
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(memberId);
    await member.roles.add(VERIFIED_ROLE_ID);
    res.json({ success: true, message: 'Role přidána!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Chyba při přidávání role' });
  }
});

app.listen(PORT, () => console.log(`Web API běží na portu ${PORT}`));

// Příkaz m! sac
client.on('messageCreate', message => {
  if (message.content.toLowerCase() === 'm! sac') {
    message.channel.send('🍀 SAC MYCHAL 🍀');
  }
});

client.once('ready', () => {
  console.log(`Bot online jako ${client.user.tag}`);
});

client.login(TOKEN);
