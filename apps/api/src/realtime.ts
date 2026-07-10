import { Server } from "socket.io";
import type { FastifyInstance } from "fastify";
import { env, webOrigins } from "./config/env";

const allowedRoom = /^(?:hall|office|symposium|library|amphitheater|funding|communities|opportunities|community:[a-z0-9_-]{1,80})$/;

export const attachRealtime = (app: FastifyInstance) => {
  const io = new Server(app.server, {
    cors: {
      origin: webOrigins,
      credentials: true
    },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, Boolean(origin ? webOrigins.includes(origin) : env.NODE_ENV !== "production"));
    },
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 25_000,
    pingTimeout: 20_000
  });

  io.on("connection", (socket) => {
    socket.emit("symposium:ready", { ok: true });

    socket.on("symposium:join", (room: string) => {
      if (typeof room === "string" && allowedRoom.test(room) && socket.rooms.size < 21) {
        void socket.join(room);
      }
    });

    socket.on("symposium:leave", (room: string) => {
      if (typeof room === "string" && allowedRoom.test(room)) {
        void socket.leave(room);
      }
    });
  });

  return io;
};
