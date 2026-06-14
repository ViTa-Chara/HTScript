import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const email = process.env.ADMIN_EMAIL || "admin@example.com";
const phone = process.env.ADMIN_PHONE || null;
const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";
const displayName = process.env.ADMIN_NAME || "Owner";

async function main() {
  const passwordHash = await bcrypt.hash(password, 12);
  const owner = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, displayName, role: "OWNER" },
    create: { email, phone, passwordHash, displayName, role: "OWNER" }
  });
  console.log(`Owner account ready: ${owner.email ?? owner.phone}`);
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
