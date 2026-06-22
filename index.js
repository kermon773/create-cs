require('dotenv').config();
const { Client, Intents, MessageEmbed } = require('discord.js');
const { askAI } = require('./ai');
const config = require('./config.json');
const {
  handleCrCsCommand,
  handleCreateCsButton,
  handleCsModalSubmit,
  BUTTON_ID,
  MODAL_ID
} = require('./commands/cr-cs');

// ─── Validate config token ───────────────────────────────────────────────────
if (!config.token || config.token === 'ISI_TOKEN_BOT_DISINI') {
  console.error('[ERROR] Token bot belum diisi di config.json!');
  process.exit(1);
}

// ─── Client setup ────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
    Intents.FLAGS.DIRECT_MESSAGES,
    Intents.FLAGS.MESSAGE_CONTENT
  ],
  partials: ['CHANNEL', 'MESSAGE']
});

const PREFIX = process.env.PREFIX || config.prefix || '%';

// ─── Active AI sessions (per-channel, per-user cooldown) ─────────────────────
const aiCooldown = new Map();
const COOLDOWN_MS = 3000;

// ─── Ready ───────────────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);
  console.log(`[BOT] Prefix: ${PREFIX}`);
  console.log(`[BOT] Servers: ${client.guilds.cache.size}`);
  client.user.setActivity(`${PREFIX}help | AI Ready`, { type: 'WATCHING' });
});

// ─── Message handler ─────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  // Ignore bots
  if (message.author.bot) return;

  const content = message.content.trim();

  // Must start with prefix
  if (!content.startsWith(PREFIX)) return;

  const args = content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  // ── %cr-cs ────────────────────────────────────────────────────────────────
  if (command === 'cr-cs') {
    try {
      await handleCrCsCommand(message);
    } catch (err) {
      console.error('[CMD cr-cs]', err.message);
      message.reply({ content: `❌ Error: ${err.message}` }).catch(() => {});
    }
    return;
  }

  // ── %ai <query> ───────────────────────────────────────────────────────────
  if (command === 'ai') {
    const query = args.join(' ').trim();

    if (!query) {
      return message.reply('❓ Contoh penggunaan: `%ai siapa kamu?`');
    }

    // Cooldown check
    const cooldownKey = `${message.author.id}-${message.channelId}`;
    const lastUsed = aiCooldown.get(cooldownKey);
    if (lastUsed && Date.now() - lastUsed < COOLDOWN_MS) {
      const remaining = ((COOLDOWN_MS - (Date.now() - lastUsed)) / 1000).toFixed(1);
      return message.reply(`⏳ Cooldown ${remaining}s lagi.`);
    }
    aiCooldown.set(cooldownKey, Date.now());

    const thinkingMsg = await message.channel.send('🤔 Sedang berpikir...');

    try {
      const response = await askAI(query);

      // Split response if too long for Discord (2000 char limit)
      if (response.length <= 1900) {
        await thinkingMsg.edit(`💬 **${message.author.username}:** ${query}\n\n🤖 ${response}`);
      } else {
        await thinkingMsg.edit(`💬 **${message.author.username}:** ${query}`);
        // Send in chunks
        const chunks = splitText(response, 1900);
        for (const chunk of chunks) {
          await message.channel.send(chunk);
        }
      }
    } catch (err) {
      console.error('[CMD ai]', err.message);
      await thinkingMsg.edit(`❌ Gagal mendapat respons AI: ${err.message}`);
    }
    return;
  }

  // ── %help ─────────────────────────────────────────────────────────────────
  if (command === 'help') {
    const embed = new MessageEmbed()
      .setColor(config.embedColor)
      .setTitle('📖 Daftar Command')
      .addFields(
        {
          name: `\`${PREFIX}ai <pertanyaan>\``,
          value: 'Tanya AI apapun yang kamu mau.',
          inline: false
        },
        {
          name: `\`${PREFIX}cr-cs\``,
          value: 'Kirim embed + tombol untuk membuat Character Story otomatis via AI.',
          inline: false
        },
        {
          name: `\`${PREFIX}help\``,
          value: 'Tampilkan daftar command ini.',
          inline: false
        }
      )
      .setFooter({ text: 'Character Story Bot • Powered by Claude Sonnet' })
      .setTimestamp();

    await message.channel.send({ embeds: [embed] });
    return;
  }
});

// ─── Interaction handler (buttons + modals) ───────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  // Button: Create CS
  if (interaction.isButton() && interaction.customId === BUTTON_ID) {
    try {
      await handleCreateCsButton(interaction);
    } catch (err) {
      console.error('[BUTTON create_cs]', err.message);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: `❌ Error membuka form: ${err.message}`,
          ephemeral: true
        }).catch(() => {});
      }
    }
    return;
  }

  // Modal: CS Form Submit
  if (interaction.isModalSubmit() && interaction.customId === MODAL_ID) {
    try {
      await handleCsModalSubmit(interaction);
    } catch (err) {
      console.error('[MODAL cs_form]', err.message);
      const payload = {
        embeds: [
          new MessageEmbed()
            .setColor(config.embedColorError)
            .setTitle('❌ Gagal Memproses Form')
            .setDescription(`\`${err.message}\`\n\nCoba lagi.`)
        ],
        ephemeral: true
      };
      if (interaction.deferred) {
        await interaction.editReply(payload).catch(() => {});
      } else if (!interaction.replied) {
        await interaction.reply(payload).catch(() => {});
      }
    }
    return;
  }
});

// ─── Error handlers ───────────────────────────────────────────────────────────
client.on('error', (err) => console.error('[CLIENT ERROR]', err.message));
process.on('unhandledRejection', (err) => console.error('[UNHANDLED]', err));

// ─── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Split long text into chunks of maxLen characters
 */
function splitText(text, maxLen = 1900) {
  const chunks = [];
  let current = '';
  const lines = text.split('\n');

  for (const line of lines) {
    if ((current + '\n' + line).length > maxLen) {
      if (current) chunks.push(current.trim());
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

// ─── Login ────────────────────────────────────────────────────────────────────
client.login(config.token);
