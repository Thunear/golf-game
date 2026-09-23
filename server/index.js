import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { RoomManager } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const distDir = path.join(__dirname, '..', 'dist');

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((req, res) => res.sendFile(path.join(distDir, 'index.html')));
} else {
  app.get('/', (req, res) =>
    res
      .type('text')
      .send(
        'Client not built. Run "npm run build" for production, or "npm run dev" for development (then open http://localhost:5173).'
      )
  );
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const rooms = new RoomManager(io);
io.on('connection', (socket) => rooms.attach(socket));

server.listen(PORT, () => {
  console.log(`Designsystemet golf server listening on http://localhost:${PORT}`);
});
