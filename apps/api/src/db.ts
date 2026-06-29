// Single shared PrismaClient instance for the whole process.
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
