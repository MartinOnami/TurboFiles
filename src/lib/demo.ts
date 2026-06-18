/**
 * Demo data used only when the app runs outside the Tauri shell (e.g. `vite dev`
 * in a plain browser, or Storybook). Lets the UI be developed without a backend.
 */
import type { DirEntry, LogEntry, Site, Transfer } from "./types";

export const demoSites: Site[] = [
  {
    id: "1",
    name: "My Server",
    protocol: "sftp",
    host: "sftp.example.com",
    port: 22,
    username: "john_doe",
    logonType: "normal",
    hasStoredSecret: true,
    createdAt: "2026-06-01T08:00:00Z",
    updatedAt: "2026-06-10T08:00:00Z",
  },
  {
    id: "2",
    name: "Production Server",
    protocol: "ftp",
    host: "ftp.example.com",
    port: 21,
    username: "deploy",
    logonType: "normal",
    hasStoredSecret: true,
    createdAt: "2026-06-01T08:00:00Z",
    updatedAt: "2026-06-10T08:00:00Z",
  },
];

export const demoLocal: DirEntry[] = [
  { name: "my-app", path: "/Users/johndoe/Documents/Projects/my-app", kind: "directory", size: 0, modified: "5/10/2024, 9:41 AM" },
  { name: "website", path: "/Users/johndoe/Documents/Projects/website", kind: "directory", size: 0, modified: "5/09/2024, 3:22 PM" },
  { name: "design-system", path: "/Users/johndoe/Documents/Projects/design-system", kind: "directory", size: 0, modified: "5/08/2024, 11:15 AM" },
  { name: "README.md", path: "/Users/johndoe/Documents/Projects/README.md", kind: "file", size: 2400, modified: "5/10/2024, 9:40 AM" },
  { name: "package.json", path: "/Users/johndoe/Documents/Projects/package.json", kind: "file", size: 1200, modified: "5/10/2024, 9:41 AM" },
  { name: "vite.config.ts", path: "/Users/johndoe/Documents/Projects/vite.config.ts", kind: "file", size: 1600, modified: "5/09/2024, 2:14 PM" },
  { name: "logo.png", path: "/Users/johndoe/Documents/Projects/logo.png", kind: "file", size: 523000, modified: "5/08/2024, 10:01 AM" },
];

export const demoRemote: DirEntry[] = [
  { name: "assets", path: "/home/john_doe/public_html/assets", kind: "directory", size: 0, modified: "5/10/2024, 8:12 AM", permissions: "drwxr-xr-x", owner: "john_doe" },
  { name: "images", path: "/home/john_doe/public_html/images", kind: "directory", size: 0, modified: "5/09/2024, 6:23 AM", permissions: "drwxr-xr-x", owner: "john_doe" },
  { name: "uploads", path: "/home/john_doe/public_html/uploads", kind: "directory", size: 0, modified: "5/08/2024, 4:51 PM", permissions: "drwxr-xr-x", owner: "john_doe" },
  { name: "index.html", path: "/home/john_doe/public_html/index.html", kind: "file", size: 3100, modified: "5/10/2024, 8:10 AM", permissions: "-rw-r--r--", owner: "john_doe" },
  { name: "styles.css", path: "/home/john_doe/public_html/styles.css", kind: "file", size: 12600, modified: "5/10/2024, 8:11 AM", permissions: "-rw-r--r--", owner: "john_doe" },
  { name: "app.js", path: "/home/john_doe/public_html/app.js", kind: "file", size: 8700, modified: "5/10/2024, 8:11 AM", permissions: "-rw-r--r--", owner: "john_doe" },
];

export const demoTransfers: Transfer[] = [
  { id: "t1", direction: "upload", name: "large-video.mp4", localPath: "/Users/johndoe/Downloads/large-video.mp4", remotePath: "/home/john_doe/uploads/", status: "transferring", bytesTransferred: 712_000_000, totalBytes: 1_120_000_000, speed: 8_400_000, etaSeconds: 45 },
  { id: "t2", direction: "upload", name: "backup.zip", localPath: "/Users/johndoe/Downloads/backup.zip", remotePath: "/home/john_doe/backups/", status: "transferring", bytesTransferred: 286_000_000, totalBytes: 753_000_000, speed: 4_700_000, etaSeconds: 99 },
  { id: "t3", direction: "upload", name: "document.pdf", localPath: "/Users/johndoe/Documents/document.pdf", remotePath: "/home/john_doe/docs/", status: "queued", bytesTransferred: 0, totalBytes: 12_400_000, speed: 0, etaSeconds: null },
];

export const demoLogs: LogEntry[] = [
  { timestamp: "12:41:10", level: "info", message: "Connected to sftp.example.com:22" },
  { timestamp: "12:41:11", level: "info", message: "Listing directory /home/john_doe/public_html" },
  { timestamp: "12:41:11", level: "info", message: "Directory listing successful" },
  { timestamp: "12:41:22", level: "info", message: "Starting upload: large-video.mp4" },
];
