import nextEnv from "@next/env";
import { PrismaClient, UserRole } from "@prisma/client";
import { hash } from "bcryptjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hash("password123", 10);

  const user = await prisma.userAccount.upsert({
    where: { email: "admin@demo.local" },
    update: {
      name: "Admin User",
      passwordHash,
      role: UserRole.OPS,
      specialistId: null,
      operationsUser: {
        upsert: {
          create: { canOverride: true },
          update: { canOverride: true },
        },
      },
    },
    create: {
      email: "admin@demo.local",
      name: "Admin User",
      passwordHash,
      role: UserRole.OPS,
      operationsUser: {
        create: { canOverride: true },
      },
    },
    select: {
      id: true,
      email: true,
      role: true,
      operationsUser: {
        select: { canOverride: true },
      },
    },
  });

  console.log("admin-user-ready", JSON.stringify(user));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });