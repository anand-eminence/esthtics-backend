import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/** The five themes from the proposal. Labels are editable later; keys are not. */
const THEMES = [
  { key: "facial", label: "Facial Protocols", sortOrder: 1 },
  { key: "products", label: "Products", sortOrder: 2 },
  { key: "business", label: "Business", sortOrder: 3 },
  { key: "ingredient", label: "Ingredient Knowledge", sortOrder: 4 },
  { key: "random", label: "Random Facts", sortOrder: 5 },
];

async function main() {
  for (const theme of THEMES) {
    await prisma.theme.upsert({
      where: { key: theme.key },
      create: theme,
      update: { label: theme.label, sortOrder: theme.sortOrder },
    });
  }
  console.log(`Themes ready (${THEMES.length})`);

  await prisma.setting.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      timezone: process.env.QUIZ_TIMEZONE || "America/New_York",
      bonusEnabled: true,
      joinUrl: "https://www.esticonfidential.com/join",
      defaultGoDeeperUrl: "https://www.esticonfidential.com/library",
      quizEmbedUrl: process.env.SEED_QUIZ_EMBED_URL || "http://localhost:4000/quiz",
    },
    update: {},
  });

  // Fill the embed URL only when it is still blank, so re-seeding never
  // overwrites a real hosted URL with the local one.
  const settings = await prisma.setting.findUniqueOrThrow({ where: { id: "singleton" } });
  if (!settings.quizEmbedUrl) {
    await prisma.setting.update({
      where: { id: "singleton" },
      data: { quizEmbedUrl: process.env.SEED_QUIZ_EMBED_URL || "http://localhost:4000/quiz" },
    });
  }
  console.log("Settings ready");

  const email = (process.env.SEED_ADMIN_EMAIL || "admin@esticonfidential.com").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    console.log("SEED_ADMIN_PASSWORD not set — skipping the administrator account");
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.adminUser.upsert({
      where: { email },
      create: {
        email,
        name: process.env.SEED_ADMIN_NAME || "Administrator",
        passwordHash,
        role: "ADMINISTRATOR",
        status: "ACTIVE",
      },
      update: { passwordHash, status: "ACTIVE", role: "ADMINISTRATOR" },
    });
    console.log(`Administrator ready: ${email}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
