const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");

const GUILD_CONFIG_FILE = path.join(__dirname, "guild_config.json");
const VANITY_CONFIG_FILE = path.join(__dirname, "vanity_configs.json");

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function getGuildConfig(guildId) {
  const all = readJson(GUILD_CONFIG_FILE, {});
  return all[guildId] ?? {};
}

function setGuildConfig(guildId, data) {
  const all = readJson(GUILD_CONFIG_FILE, {});
  all[guildId] = data;
  writeJson(GUILD_CONFIG_FILE, all);
}

function getVanityConfigs(guildId) {
  const all = readJson(VANITY_CONFIG_FILE, {});
  return all[guildId] ?? [];
}

function setVanityConfigs(guildId, configs) {
  const all = readJson(VANITY_CONFIG_FILE, {});
  all[guildId] = configs;
  writeJson(VANITY_CONFIG_FILE, all);
}

function getTicketBotId(guildId) {
  return getGuildConfig(guildId).ticketBotId ?? null;
}

function getPrefix(guildId) {
  return getGuildConfig(guildId).prefix ?? DEFAULT_PREFIX;
}

function getStaffRoles(guildId) {
  const configured = getGuildConfig(guildId).staffRoles;
  return configured && configured.length > 0 ? configured : STAFF_ROLES;
}

function getVouchChannel(guildId) {
  return getGuildConfig(guildId).vouchChannelId ?? null;
}

function isStaff(member) {
  return getStaffRoles(member.guild.id).some(id => member.roles.cache.has(id));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildPresences,
  ],
});

const DEFAULT_PREFIX = "$";
const DEV_ID = "1265799891607879853";
const STAFF_ROLES = ["1503067696017834124", "1503068138080829440"];
const LOG_CHANNEL_ID = "1478979915851235361";

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    await guild.members.fetch().catch(() => {});
  }
});

client.on("error", (err) => console.error("Client error:", err.message));

// ─── Presence Update: auto-assign / remove vanity roles ───────────────────────
client.on("presenceUpdate", async (oldPresence, newPresence) => {
  try {
    const guild = newPresence?.guild;
    if (!guild) return;

    const member = await guild.members.fetch(newPresence.userId).catch(() => null);
    if (!member || member.user.bot) return;

    const configs = getVanityConfigs(guild.id);
    if (!configs || configs.length === 0) return;

    const customActivity = newPresence.activities?.find(a => a.type === 4);
    const statusText = customActivity?.state?.toLowerCase() ?? "";

    for (const cfg of configs) {
      const matched = cfg.texts.some(t => {
        const text = t.toLowerCase();
        return cfg.matchType === "exact"
          ? statusText === text
          : statusText.includes(text);
      });

      for (const roleId of cfg.roles) {
        const role = guild.roles.cache.get(roleId);
        if (!role) continue;

        if (matched && !member.roles.cache.has(roleId)) {
          await member.roles.add(role).catch(() => {});
        } else if (!matched && member.roles.cache.has(roleId)) {
          await member.roles.remove(role).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error("presenceUpdate error:", err.message);
  }
});

// ─── Helper: ask a question and wait for a reply ──────────────────────────────
async function ask(channel, userId, question, timeout = 60000) {
  await channel.send(question);
  const collected = await channel.awaitMessages({
    filter: m => m.author.id === userId,
    max: 1,
    time: timeout,
    errors: ["time"],
  }).catch(() => null);
  return collected?.first() ?? null;
}

// ─── Message handler ──────────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  const prefix = message.guild ? getPrefix(message.guild.id) : DEFAULT_PREFIX;
  if (message.author.bot || !message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ── $ping ──────────────────────────────────────────────────────────────────
  if (command === "ping") {
    const sent = await message.reply("pinging...");
    const latency = sent.createdTimestamp - message.createdTimestamp;
    sent.edit(`pong! 🏓 \`${latency}ms\``);
  }

  // ── $vouch ─────────────────────────────────────────────────────────────────
  if (command === "vouch") {
    if (!isStaff(message.member)) return message.reply("you don't have permission to use this.");

    const vouchChannelId = getVouchChannel(message.guild.id);
    if (!vouchChannelId) {
      return message.reply(`no vouch channel configured for this server. An admin must run \`${prefix}vouchchannel <#channel>\` first.`);
    }

    const embed = new EmbedBuilder()
      .setTitle("Vouch Us!")
      .setDescription(
        `➡️ Please type: **vouch ${message.author} ${args.join(" ")}** in <#${vouchChannelId}> to support us and show others that we are legit!`
      )
      .setColor(0x5865f2);

    message.channel.send({ embeds: [embed] });
  }

  // ── $inrole ────────────────────────────────────────────────────────────────
  if (command === "inrole") {
    const query = args.join(" ");
    if (!query) return message.reply("please provide a role name or ID.");

    const mentionMatch = query.match(/^<@&(\d+)>$/);
    let role = mentionMatch
      ? message.guild.roles.cache.get(mentionMatch[1])
      : message.guild.roles.cache.get(query);

    if (!role) {
      const lowerQuery = query.toLowerCase();
      role = message.guild.roles.cache
        .filter(r => r.name.toLowerCase().includes(lowerQuery))
        .sort((a, b) => {
          const ai = a.name.toLowerCase().indexOf(lowerQuery);
          const bi = b.name.toLowerCase().indexOf(lowerQuery);
          return ai - bi;
        })
        .first();
    }

    if (!role) return message.reply(`couldn't find a role matching **${query}**.`);

    const members = role.members.map(m => m.user.username).sort();
    if (members.length === 0) return message.reply(`no members in **${role.name}**.`);

    const pageSize = 20;
    const pages = [];
    for (let i = 0; i < members.length; i += pageSize) {
      pages.push(members.slice(i, i + pageSize));
    }

    let page = 0;
    const buildEmbed = (p) => new EmbedBuilder()
      .setTitle(`Members in ${role.name} — ${members.length} total`)
      .setDescription(pages[p].join("\n"))
      .setColor(role.color || 0x5865f2)
      .setFooter({ text: `Page ${p + 1}/${pages.length}` });

    const msg = await message.channel.send({ embeds: [buildEmbed(0)] });
    if (pages.length === 1) return;

    await msg.react("◀️");
    await msg.react("▶️");

    const collector = msg.createReactionCollector({
      filter: (reaction, user) =>
        ["◀️", "▶️"].includes(reaction.emoji.name) && user.id === message.author.id,
      time: 60000,
    });

    collector.on("collect", (reaction, user) => {
      reaction.users.remove(user.id);
      if (reaction.emoji.name === "▶️" && page < pages.length - 1) page++;
      else if (reaction.emoji.name === "◀️" && page > 0) page--;
      msg.edit({ embeds: [buildEmbed(page)] });
    });

    collector.on("end", () => msg.reactions.removeAll().catch(() => {}));
  }

  // ── $clearinvites ──────────────────────────────────────────────────────────
  if (command === "clearinvites") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return message.reply("you don't have permission to do that.");
    }

    try {
      const invites = await message.guild.invites.fetch();
      let deleted = 0;

      for (const invite of invites.values()) {
        await invite.delete();
        deleted++;
      }

      message.reply(
        deleted > 0
          ? `done! deleted **${deleted}** invite${deleted !== 1 ? "s" : ""}.`
          : "no invites to delete."
      );
    } catch (err) {
      console.error(err);
      message.reply("something went wrong while deleting invites.");
    }
  }

  // ── $vouchchannel ──────────────────────────────────────────────────────────
  if (command === "vouchchannel") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return message.reply("you need the **Manage Server** permission to use this.");
    }

    const input = args[0];
    if (!input) {
      const currentId = getVouchChannel(message.guild.id);
      const current = currentId
        ? `Currently configured vouch channel: <#${currentId}>`
        : "No vouch channel configured yet.";
      return message.reply(
        `${current}\n\nUsage:\n` +
        `• Same server: \`${prefix}vouchchannel #channel\`\n` +
        `• Another server: \`${prefix}vouchchannel <channel ID>\``
      );
    }

    const mentionMatch = input.match(/^<#(\d+)>$/);
    const channelId = mentionMatch ? mentionMatch[1] : (/^\d{17,20}$/.test(input) ? input : null);

    if (!channelId) {
      return message.reply("invalid input. Use a channel mention or a channel ID.");
    }

    const guildConfig = getGuildConfig(message.guild.id);
    guildConfig.vouchChannelId = channelId;
    setGuildConfig(message.guild.id, guildConfig);

    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅ Vouch Channel Set")
          .setDescription(`Vouch channel set to <#${channelId}> for this server.`)
          .setColor(0x57f287)
          .setFooter({ text: "This channel will be used in vouch and wait messages." })
          .setTimestamp()
      ]
    });
  }

  // ── $staffroles ────────────────────────────────────────────────────────────
  if (command === "staffroles") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return message.reply("you need the **Manage Server** permission to use this.");
    }

    const sub = args[0]?.toLowerCase();
    const guildConfig = getGuildConfig(message.guild.id);
    const current = guildConfig.staffRoles ?? [];

    if (!sub || sub === "list") {
      if (current.length === 0) {
        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🛡️ Staff Roles")
              .setDescription(`No custom staff roles configured — using the default built-in roles.\nUse \`${prefix}staffroles add @role\` to add roles.`)
              .setColor(0x5865f2)
          ]
        });
      }
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🛡️ Staff Roles")
            .setDescription(current.map(id => `<@&${id}>`).join("\n"))
            .setColor(0x5865f2)
            .setFooter({ text: `${current.length} role(s) configured` })
        ]
      });
    }

    if (sub === "add") {
      const mentioned = [...message.content.matchAll(/<@&(\d+)>/g)].map(m => m[1]);
      if (mentioned.length === 0) return message.reply("please mention at least one role to add.");

      const added = [];
      for (const id of mentioned) {
        if (!current.includes(id)) { current.push(id); added.push(id); }
      }

      guildConfig.staffRoles = current;
      setGuildConfig(message.guild.id, guildConfig);

      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Staff Roles Updated")
            .setDescription(added.length > 0 ? `Added: ${added.map(id => `<@&${id}>`).join(", ")}` : "Those roles were already in the list.")
            .setColor(0x57f287)
        ]
      });
    }

    if (sub === "remove") {
      const mentioned = [...message.content.matchAll(/<@&(\d+)>/g)].map(m => m[1]);
      if (mentioned.length === 0) return message.reply("please mention at least one role to remove.");

      const before = current.length;
      const updated = current.filter(id => !mentioned.includes(id));
      const removedCount = before - updated.length;

      guildConfig.staffRoles = updated;
      setGuildConfig(message.guild.id, guildConfig);

      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Staff Roles Updated")
            .setDescription(
              removedCount > 0
                ? `Removed ${removedCount} role(s). ${updated.length === 0 ? "No custom roles remain — falling back to defaults." : `Remaining: ${updated.map(id => `<@&${id}>`).join(", ")}`}`
                : "None of those roles were in the list."
            )
            .setColor(0x57f287)
        ]
      });
    }

    if (sub === "clear") {
      guildConfig.staffRoles = [];
      setGuildConfig(message.guild.id, guildConfig);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Staff Roles Cleared")
            .setDescription("All custom staff roles removed. Falling back to the default built-in roles.")
            .setColor(0x57f287)
        ]
      });
    }

    return message.reply(`unknown subcommand. Usage:\n\`${prefix}staffroles list\` — view current roles\n\`${prefix}staffroles add @role\` — add a role\n\`${prefix}staffroles remove @role\` — remove a role\n\`${prefix}staffroles clear\` — reset to defaults`);
  }

  // ── $prefix ────────────────────────────────────────────────────────────────
  if (command === "prefix") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return message.reply("you need the **Manage Server** permission to use this.");
    }

    const newPrefix = args[0];
    if (!newPrefix) {
      return message.reply(`the current prefix for this server is \`${prefix}\`. Use \`${prefix}prefix <new prefix>\` to change it.`);
    }

    if (newPrefix.length > 5) return message.reply("prefix must be 5 characters or fewer.");
    if (/\s/.test(newPrefix)) return message.reply("prefix cannot contain spaces.");

    const guildConfig = getGuildConfig(message.guild.id);
    guildConfig.prefix = newPrefix;
    setGuildConfig(message.guild.id, guildConfig);

    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅ Prefix Updated")
          .setDescription(`Server prefix changed to \`${newPrefix}\``)
          .setColor(0x57f287)
          .setFooter({ text: `Example: ${newPrefix}help` })
          .setTimestamp()
      ]
    });
  }

  // ── $setup ─────────────────────────────────────────────────────────────────
  if (command === "setup") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return message.reply("you need the **Manage Server** permission to use this.");
    }

    const input = args[0];
    if (!input) {
      const currentId = getTicketBotId(message.guild.id);
      const current = currentId
        ? `Currently configured ticket bot: <@${currentId}> (\`${currentId}\`)`
        : "No ticket bot configured yet.";
      return message.reply(`${current}\n\nUsage: \`${prefix}setup <bot ID or @mention>\` — set the ticket bot for this server.`);
    }

    const mentionMatch = input.match(/^<@!?(\d+)>$/);
    const botId = mentionMatch ? mentionMatch[1] : input;

    if (!/^\d{17,20}$/.test(botId)) {
      return message.reply("invalid bot ID. Please provide a valid Discord user/bot ID or mention.");
    }

    const guildConfig = getGuildConfig(message.guild.id);
    guildConfig.ticketBotId = botId;
    setGuildConfig(message.guild.id, guildConfig);

    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅ Ticket Bot Configured")
          .setDescription(`Ticket bot set to <@${botId}> (\`${botId}\`) for this server.`)
          .setColor(0x57f287)
          .setFooter({ text: "All ticket commands will now use this bot to identify tickets." })
          .setTimestamp()
      ]
    });
  }

  // ── $rn ────────────────────────────────────────────────────────────────────
  if (command === "rn") {
    if (!isStaff(message.member)) return message.reply("you don't have permission to use this.");

    const ticketBotId = getTicketBotId(message.guild.id);
    if (!ticketBotId) {
      return message.reply(`no ticket bot configured for this server. An admin must run \`${prefix}setup <bot ID>\` first.`);
    }

    const isTicket = message.channel.permissionOverwrites?.cache.has(ticketBotId);
    if (!isTicket) return message.reply("not a ticket.");

    const newName = args.join("-").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!newName) return message.reply("please provide a valid ticket name (letters, numbers, hyphens only).");

    try {
      const oldName = message.channel.name;
      await message.channel.setName(newName);
      const logChannel = message.guild.channels.cache.get(LOG_CHANNEL_ID);
      if (logChannel) {
        logChannel.send({ embeds: [
          new EmbedBuilder()
            .setTitle("✏️ Ticket Renamed")
            .setColor(0x5865f2)
            .addFields(
              { name: "Before", value: `\`${oldName}\``, inline: true },
              { name: "After", value: `\`${newName}\``, inline: true },
              { name: "By", value: `${message.author}`, inline: true },
            )
            .setTimestamp()
        ]});
      }
      return message.reply(`renamed ticket to **${newName}**.`);
    } catch (err) {
      console.error("rn error:", err.message);
      return message.reply("something went wrong while renaming the ticket.");
    }
  }

  // ── $close ─────────────────────────────────────────────────────────────────
  if (command === "close") {
    if (!isStaff(message.member)) return message.reply("you don't have permission to use this.");

    const ticketBotId = getTicketBotId(message.guild.id);
    if (!ticketBotId) {
      return message.reply(`no ticket bot configured for this server. An admin must run \`${prefix}setup <bot ID>\` first.`);
    }

    const isTicket = message.channel.permissionOverwrites?.cache.has(ticketBotId);
    if (!isTicket) return message.reply("not a ticket.");

    const ticketName = message.channel.name;
    const closer = message.author;
    await message.channel.send("🔒 Closing ticket...");
    try {
      const logChannel = message.guild.channels.cache.get(LOG_CHANNEL_ID);
      if (logChannel) {
        await logChannel.send({ embeds: [
          new EmbedBuilder()
            .setTitle("🔒 Ticket Closed")
            .setColor(0xed4245)
            .addFields(
              { name: "Ticket", value: `\`${ticketName}\``, inline: true },
              { name: "Closed by", value: `${closer}`, inline: true },
            )
            .setTimestamp()
        ]});
      }
      await message.channel.delete();
    } catch (err) {
      console.error("close error:", err.message);
      message.reply("something went wrong while closing the ticket.");
    }
  }

  // ── $remind ────────────────────────────────────────────────────────────────
  if (command === "remind") {
    if (!isStaff(message.member)) return message.reply("you don't have permission to use this.");

    const ticketBotId = getTicketBotId(message.guild.id);
    if (!ticketBotId) {
      return message.reply(`no ticket bot configured for this server. An admin must run \`${prefix}setup <bot ID>\` first.`);
    }

    const isTicket = message.channel.permissionOverwrites?.cache.has(ticketBotId);
    if (!isTicket) return message.reply("not a ticket.");

    const target = message.mentions.users.first()
      ?? (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null);

    if (!target) return message.reply("please mention a user or provide their ID.");

    try {
      await target.send(
        `👋 Hey **${target.username}**, you have an open ticket in **${message.guild.name}** that needs your attention!\n` +
        `➡️ Head back to your ticket: ${message.channel.url}`
      );
      message.reply(`✅ Sent a reminder to **${target.username}** via DM.`);
    } catch {
      message.reply(`❌ Couldn't DM **${target.username}** — they may have DMs disabled.`);
    }
  }

  // ── $proof ─────────────────────────────────────────────────────────────────
  if (command === "proof") {
    if (!isStaff(message.member)) return message.reply("you don't have permission to use this.");

    const ticketBotId = getTicketBotId(message.guild.id);
    if (!ticketBotId) {
      return message.reply(`no ticket bot configured for this server. An admin must run \`${prefix}setup <bot ID>\` first.`);
    }

    const isTicket = message.channel.permissionOverwrites?.cache.has(ticketBotId);
    if (!isTicket) return message.reply("not a ticket.");

    const embed = new EmbedBuilder()
      .setTitle("Proofs")
      .setDescription(
        "➡️ Please send **screenshot proofs** of your invites.\n" +
        "This is a check we do to make sure you don't invite bots or fake accounts."
      )
      .setColor(0x5865f2);

    message.channel.send({ embeds: [embed] });
  }

  // ── $wait ──────────────────────────────────────────────────────────────────
  if (command === "wait") {
    if (!isStaff(message.member)) return message.reply("you don't have permission to use this.");

    const ticketBotId = getTicketBotId(message.guild.id);
    if (!ticketBotId) {
      return message.reply(`no ticket bot configured for this server. An admin must run \`${prefix}setup <bot ID>\` first.`);
    }

    const isTicket = message.channel.permissionOverwrites?.cache.has(ticketBotId);
    if (!isTicket) return message.reply("not a ticket.");

    const vouchId = getVouchChannel(message.guild.id);
    const vouchRef = vouchId ? `<#${vouchId}>` : "the vouch channel";

    const embed = new EmbedBuilder()
      .setDescription(
        "➡️ We are trying our best to pay the rewards fast. There are other people claiming before you.\n\n" +
        "🤝 What we're asking you:\n" +
        `**1.**: Wait patiently for your reward, you will be paid (check ${vouchRef})\n` +
        "**2.**: Please don't spam ping the staff team, pinging them will not make the payment faster.\n" +
        "**3.**: Stay polite in tickets."
      )
      .setColor(0x5865f2);

    message.channel.send({ embeds: [embed] });
  }

  // ── $help ──────────────────────────────────────────────────────────────────
  if (command === "help") {
    const embed = new EmbedBuilder()
      .setTitle("📋 Commands")
      .setColor(0x5865f2)
      .addFields(
        {
          name: "👤 Regular",
          value: [
            `\`${prefix}ping\` — check bot latency`,
            `\`${prefix}vouch\` — send a vouch prompt in the current ticket`,
            `\`${prefix}inrole <role>\` — list all members in a role`,
            `\`${prefix}ticketcount\` — show how many tickets are currently open`,
            `\`${prefix}rn <name>\` — rename the current ticket channel`,
            `\`${prefix}close\` — close and delete the current ticket`,
            `\`${prefix}remind <@user|id>\` — DM a user about their open ticket`,
            `\`${prefix}wait\` — send the standard patience message in a ticket`,
            `\`${prefix}proof\` — ask the user to send screenshot proof of invites`,
          ].join("\n"),
          inline: false,
        },
        {
          name: "⚙️ Admin",
          value: [
            `\`${prefix}prefix <prefix>\` — change the bot prefix for this server`,
            `\`${prefix}setup <bot ID>\` — set which ticket bot is used on this server`,
            `\`${prefix}vouchchannel <#channel>\` — set the channel used in vouch and wait messages`,
            `\`${prefix}staffroles <add|remove|list|clear>\` — manage which roles can use ticket commands`,
            `\`${prefix}clearinvites\` — delete all active server invites`,
            `\`${prefix}vanitysetup\` — set up a vanity status role reward`,
            `\`${prefix}vanitylist\` — view all vanity role configs`,
            `\`${prefix}vanityremove <number>\` — remove a vanity role config by number`,
          ].join("\n"),
          inline: false,
        },
        {
          name: "🛠️ Dev",
          value: [
            `\`${prefix}restart\` — restart the bot process`,
            `\`${prefix}reload\` — reload the bot (same as restart)`,
            `\`${prefix}shutdown\` — shut the bot down without restarting`,
            `\`${prefix}eval <code>\` — run arbitrary JavaScript code`,
          ].join("\n"),
          inline: false,
        },
      )
      .setFooter({ text: `Prefix: ${prefix}` });

    message.channel.send({ embeds: [embed] });
  }

  // ── $ticketcount ───────────────────────────────────────────────────────────
  if (command === "ticketcount") {
    const ticketBotId = getTicketBotId(message.guild.id);
    if (!ticketBotId) {
      return message.reply(`no ticket bot configured for this server. An admin must run \`${prefix}setup <bot ID>\` first.`);
    }

    const ticketChannels = message.guild.channels.cache.filter(
      c => c.permissionOverwrites?.cache.has(ticketBotId)
    );
    const count = ticketChannels.size;

    const embed = new EmbedBuilder()
      .setTitle("🎫 Open Tickets")
      .setDescription(`There are currently **${count}** open ticket${count !== 1 ? "s" : ""}.`)
      .setColor(0x5865f2)
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
  }

  // ── DEV ONLY ───────────────────────────────────────────────────────────────
  if (message.author.id === DEV_ID) {

    if (command === "restart") {
      await message.reply("🔄 Restarting...");
      process.exit(0);
    }

    if (command === "reload") {
      await message.reply("🔃 Reloading bot...");
      process.exit(0);
    }

    if (command === "shutdown") {
      await message.reply("🛑 Shutting down...");
      process.exit(1);
    }

    if (command === "eval") {
      const code = args.join(" ");
      if (!code) return message.reply("provide code to evaluate.");
      try {
        let result = eval(code);
        if (result instanceof Promise) result = await result;
        const output = typeof result === "object" ? JSON.stringify(result, null, 2) : String(result);
        const truncated = output.length > 1900 ? output.slice(0, 1900) + "\n..." : output;
        message.reply(`\`\`\`js\n${truncated}\n\`\`\``);
      } catch (err) {
        message.reply(`\`\`\`\n${err.message}\n\`\`\``);
      }
    }

  }

  // ── $vanitysetup ───────────────────────────────────────────────────────────
  if (command === "vanitysetup") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return message.reply("you need the **Manage Roles** permission to use this.");
    }

    const ch = message.channel;
    const userId = message.author.id;

    await ch.send({ embeds: [
      new EmbedBuilder()
        .setTitle("🎀 Vanity Role Setup")
        .setDescription(
          "Let's set up a vanity status role reward. I'll ask you a few questions.\n" +
          "Type `cancel` at any time to abort."
        )
        .setColor(0x5865f2)
    ]});

    const textMsg = await ask(ch, userId,
      "**Step 1/3 — Status text(s)**\nWhat text(s) should be in the member's custom status? " +
      "Separate multiple values with a comma.\n> Example: `discord.gg/myserver, .gg/myserver`"
    );
    if (!textMsg || textMsg.content.toLowerCase() === "cancel") return ch.send("❌ Setup cancelled.");

    const texts = textMsg.content.split(",").map(t => t.trim()).filter(Boolean);
    if (texts.length === 0) return ch.send("❌ No valid texts provided. Setup cancelled.");

    const matchMsg = await ask(ch, userId,
      "**Step 2/3 — Match type**\nShould the status **contain** the text, or must it be an **exact** match?\n" +
      "Reply with `contains` or `exact`."
    );
    if (!matchMsg || matchMsg.content.toLowerCase() === "cancel") return ch.send("❌ Setup cancelled.");

    const matchType = matchMsg.content.toLowerCase().trim();
    if (!["contains", "exact"].includes(matchType))
      return ch.send("❌ Invalid match type. Please reply with `contains` or `exact`. Setup cancelled.");

    const roleMsg = await ask(ch, userId,
      "**Step 3/3 — Role(s) to give**\nMention the role(s) to assign when the status matches. " +
      "You can mention multiple roles.\n> Example: `@VanityRep @Advertiser`"
    );
    if (!roleMsg || roleMsg.content.toLowerCase() === "cancel") return ch.send("❌ Setup cancelled.");

    const roleIds = [...roleMsg.content.matchAll(/<@&(\d+)>/g)].map(m => m[1]);
    if (roleIds.length === 0)
      return ch.send("❌ No valid role mentions found. Please mention roles using @. Setup cancelled.");

    const botMember = await message.guild.members.fetchMe();
    const botHighest = botMember.roles.highest.position;
    const validRoles = [];
    const invalidRoles = [];

    for (const id of roleIds) {
      const r = message.guild.roles.cache.get(id);
      if (!r) { invalidRoles.push(id); continue; }
      if (r.position >= botHighest) { invalidRoles.push(`${r.name} (too high)`); continue; }
      validRoles.push(id);
    }

    if (validRoles.length === 0)
      return ch.send("❌ None of the roles could be managed by the bot. Make sure the bot's role is above the target roles.");

    const configs = getVanityConfigs(message.guild.id);
    configs.push({ texts, matchType, roles: validRoles });
    setVanityConfigs(message.guild.id, configs);

    const roleNames = validRoles.map(id => `<@&${id}>`).join(", ");
    const textList = texts.map(t => `\`${t}\``).join(", ");

    ch.send({ embeds: [
      new EmbedBuilder()
        .setTitle("✅ Vanity Role Setup Complete")
        .setColor(0x57f287)
        .addFields(
          { name: "Status Text(s)", value: textList, inline: false },
          { name: "Match Type", value: matchType === "contains" ? "Status **contains** the text" : "Status must **exactly** match", inline: false },
          { name: "Role(s) to Give", value: roleNames, inline: false }
        )
        .setFooter({ text: invalidRoles.length > 0 ? `Skipped: ${invalidRoles.join(", ")}` : "All roles configured successfully." })
        .setTimestamp()
    ]});
  }

  // ── $vanitylist ────────────────────────────────────────────────────────────
  if (command === "vanitylist") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return message.reply("you need the **Manage Roles** permission to use this.");
    }

    const configs = getVanityConfigs(message.guild.id);

    if (!configs || configs.length === 0)
      return message.reply(`no vanity configs set up for this server. Use \`${prefix}vanitysetup\` to create one.`);

    const embed = new EmbedBuilder()
      .setTitle("🎀 Vanity Role Configs")
      .setColor(0x5865f2)
      .setTimestamp();

    configs.forEach((cfg, i) => {
      const textList = cfg.texts.map(t => `\`${t}\``).join(", ");
      const roleList = cfg.roles.map(id => `<@&${id}>`).join(", ");
      embed.addFields({
        name: `#${i + 1} — ${cfg.matchType === "contains" ? "Contains" : "Exact"}`,
        value: `**Text(s):** ${textList}\n**Role(s):** ${roleList}`,
        inline: false,
      });
    });

    embed.setFooter({ text: `Use ${prefix}vanityremove <number> to remove a config.` });
    message.channel.send({ embeds: [embed] });
  }

  // ── $vanityremove ──────────────────────────────────────────────────────────
  if (command === "vanityremove") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return message.reply("you need the **Manage Roles** permission to use this.");
    }

    const index = parseInt(args[0], 10) - 1;
    const configs = getVanityConfigs(message.guild.id);

    if (!configs || configs.length === 0)
      return message.reply("no vanity configs to remove.");

    if (isNaN(index) || index < 0 || index >= configs.length)
      return message.reply(`please provide a valid config number between 1 and ${configs.length}. Use \`${prefix}vanitylist\` to see them.`);

    const removed = configs.splice(index, 1)[0];
    setVanityConfigs(message.guild.id, configs);

    const textList = removed.texts.map(t => `\`${t}\``).join(", ");
    message.reply(`✅ Removed config #${index + 1} (${textList}).`);
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error("ERROR: DISCORD_TOKEN environment variable is not set.");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("ERROR: Failed to log in to Discord —", err.message);
  process.exit(1);
});
