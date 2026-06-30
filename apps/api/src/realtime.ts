import { Server } from "socket.io";
import type { FastifyInstance } from "fastify";
import { webOrigins } from "./config/env";

export const attachRealtime = (app: FastifyInstance) => {
  const io = new Server(app.server, {
    cors: {
      origin: webOrigins,
      credentials: true
    }
  });

  io.on("connection", (socket) => {
    socket.emit("symposium:ready", { ok: true });

    socket.on("symposium:join", (room: string) => {
      if (typeof room === "string" && room.length < 120) {
        void socket.join(room);
      }
    });

    socket.on("symposium:leave", (room: string) => {
      if (typeof room === "string" && room.length < 120) {
        void socket.leave(room);
      }
    });
  });

  return io;
};
