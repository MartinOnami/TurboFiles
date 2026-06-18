import { useState } from "react";
import { FolderOpen, Plug, Save } from "lucide-react";
import type { FtpEncryption, LogonType, Protocol } from "@/lib/types";
import { api, isTauri, pickKeyFile } from "@/lib/api";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

const PROTOCOLS: { value: Protocol; label: string; defaultPort: number }[] = [
  { value: "sftp", label: "SFTP - SSH File Transfer", defaultPort: 22 },
  { value: "ftp", label: "FTP - File Transfer", defaultPort: 21 },
];

const FTP_ENCRYPTION: { value: FtpEncryption; label: string; port: number }[] = [
  { value: "explicit_tls_if_available", label: "Use explicit FTP over TLS if available", port: 21 },
  { value: "require_explicit_tls", label: "Require explicit FTP over TLS", port: 21 },
  { value: "require_implicit_tls", label: "Require implicit FTP over TLS", port: 990 },
  { value: "plain", label: "Only use plain FTP (insecure) ⚠", port: 21 },
];

interface LogonOption {
  value: LogonType;
  label: string;
}
const SFTP_LOGON: LogonOption[] = [
  { value: "normal", label: "Normal" },
  { value: "interactive", label: "Interactive" },
  { value: "key", label: "Key file" },
];
const FTP_LOGON: LogonOption[] = [
  { value: "normal", label: "Normal" },
  { value: "anonymous", label: "Anonymous" },
];

export type ConnReq = {
  protocol: Protocol;
  host: string;
  port: number;
  username: string;
  logonType: LogonType;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  ftpEncryption?: FtpEncryption;
  acceptInvalidCert?: boolean;
};

export interface ConnectionBarProps {
  onConnect: (req: ConnReq) => void;
  onSave?: (req: ConnReq) => void;
  connecting?: boolean;
  saving?: boolean;
}

export function ConnectionBar({ onConnect, onSave, connecting, saving }: ConnectionBarProps) {
  const [protocol, setProtocol] = useState<Protocol>("sftp");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [logonType, setLogonType] = useState<LogonType>("normal");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [ftpEncryption, setFtpEncryption] = useState<FtpEncryption>("explicit_tls_if_available");

  const changeProtocol = (v: Protocol) => {
    setProtocol(v);
    if (v === "sftp") {
      setPort(22);
    } else {
      const enc = FTP_ENCRYPTION.find((e) => e.value === ftpEncryption)!;
      setPort(enc.port);
    }
    const opts = v === "sftp" ? SFTP_LOGON : FTP_LOGON;
    if (!opts.find((o) => o.value === logonType)) setLogonType(opts[0].value);
  };

  const changeEncryption = (v: FtpEncryption) => {
    setFtpEncryption(v);
    const enc = FTP_ENCRYPTION.find((e) => e.value === v)!;
    setPort(enc.port);
  };

  const changeLogon = (v: LogonType) => {
    setLogonType(v);
    if (v === "anonymous") setUsername("anonymous");
    else if (logonType === "anonymous") setUsername("");
  };

  const browseKey = async () => {
    if (!isTauri()) return;
    const path = await pickKeyFile(keyPath);
    if (!path) return;
    try {
      const c = await api.readKeyFile(path);
      setKeyPath(path);
      setPrivateKey(c);
    } catch {
      alert("Could not read key file. Check the path.");
    }
  };

  const req = (): ConnReq => ({
    protocol,
    host,
    port,
    username: logonType === "anonymous" ? "anonymous" : username,
    logonType,
    password:
      (logonType === "normal" || logonType === "interactive") && password ? password : undefined,
    privateKey: logonType === "key" && privateKey ? privateKey : undefined,
    passphrase: logonType === "key" && passphrase ? passphrase : undefined,
    ftpEncryption: protocol === "ftp" ? ftpEncryption : undefined,
  });

  const logonOpts = protocol === "sftp" ? SFTP_LOGON : FTP_LOGON;
  const showUser = logonType !== "anonymous";
  const showPass = logonType === "normal" || logonType === "interactive";
  const showKey = logonType === "key";
  const showEnc = protocol === "ftp";

  return (
    <form
      className="flex items-end gap-1.5 overflow-x-auto border-b border-border bg-surface px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        onConnect(req());
      }}
    >
      {/* Protocol */}
      <Field label="Protocol" className="shrink-0">
        <select
          value={protocol}
          onChange={(e) => changeProtocol(e.target.value as Protocol)}
          className="h-8 w-44 rounded border border-border bg-surface px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {PROTOCOLS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>

      {/* Encryption (FTP only) */}
      {showEnc && (
        <Field label="Encryption" className="shrink-0">
          <select
            value={ftpEncryption}
            onChange={(e) => changeEncryption(e.target.value as FtpEncryption)}
            className="h-8 w-56 rounded border border-border bg-surface px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {FTP_ENCRYPTION.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {/* Host */}
      <Field label="Host / IP" className="flex-1 min-w-[7rem]">
        <Input
          className="h-8 w-full text-xs"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="hostname or IP"
          required
        />
      </Field>

      {/* Port - plain text, no number spinner */}
      <Field label="Port" className="shrink-0">
        <Input
          className="h-8 w-14 text-xs"
          value={port}
          onChange={(e) => setPort(Number(e.target.value.replace(/\D/g, "")) || port)}
          placeholder="22"
        />
      </Field>

      {/* Logon Type */}
      <Field label="Logon" className="shrink-0">
        <select
          value={logonType}
          onChange={(e) => changeLogon(e.target.value as LogonType)}
          className="h-8 w-28 rounded border border-border bg-surface px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {logonOpts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      {/* Username */}
      {showUser && (
        <Field label="Username" className="shrink-0">
          <Input
            className="h-8 w-44 text-xs"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
            autoComplete="username"
          />
        </Field>
      )}

      {/* Password */}
      {showPass && (
        <Field label="Password" className="shrink-0">
          <Input
            type="password"
            className="h-8 w-44 text-xs"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
      )}

      {/* Key file */}
      {showKey && (
        <>
          <Field label="Key file" className="shrink-0 w-36">
            <div className="flex gap-1">
              <Input
                className="h-8 flex-1 min-w-0 text-xs font-mono"
                value={keyPath}
                onChange={(e) => setKeyPath(e.target.value)}
                placeholder="~/.ssh/id_rsa"
              />
              <button
                type="button"
                onClick={browseKey}
                className="flex h-8 w-7 shrink-0 items-center justify-center rounded border border-border bg-surface text-subtle hover:bg-muted"
              >
                <FolderOpen size={12} />
              </button>
            </div>
          </Field>
          <Field label="Passphrase" className="shrink-0">
            <Input
              type="password"
              className="h-8 w-20 text-xs"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="optional"
            />
          </Field>
        </>
      )}

      {/* Actions */}
      {onSave && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0 self-end"
          onClick={() => onSave(req())}
          disabled={!host}
          loading={saving}
          title="Save site"
        >
          <Save size={13} />
          Save
        </Button>
      )}
      <Button
        type="submit"
        variant="primary"
        size="sm"
        className="shrink-0 self-end"
        loading={connecting}
      >
        <Plug size={13} />
        Connect
      </Button>
    </form>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-0.5 ${className}`}>
      <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}
