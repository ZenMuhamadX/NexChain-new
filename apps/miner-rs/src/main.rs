//! NexChain external miner — keyless, stateless, RPC-only.
//!
//! Loop: `nex_getWork` → cari nonce → `nex_submitWork` → ulangi. Tidak ada
//! database, wallet, seed, atau private key: node yang memverifikasi ulang
//! setiap submit. Miner ini hanya membantu mencari nonce.
//!
//! Penggunaan:
//!   nex-miner --address NxC... [--rpc http://localhost:8000/rpc] [--threads N]
//!
//! Kredensial (kalau node memakai `RPC_USER`/`RPC_PASSWORD`):
//!   username: `--user` atau `NEX_RPC_USER`
//!   password: `NEX_RPC_PASS` atau prompt tersembunyi saat node membalas 401.
//!   Tidak ada flag `--password` — password di argumen bocor ke process list
//!   dan riwayat shell.

mod difficulty;
mod midstate;

use std::io::{IsTerminal, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use difficulty::meets_difficulty;
use midstate::{to_hex, PowHasher, MAX_NONCE};
use serde_json::{json, Value};

const DEFAULT_RPC: &str = "http://localhost:8000/rpc";
/// Nonce per pengambilan dari cursor atomik: cukup besar untuk throughput,
/// cukup kecil agar thread lain berhenti cepat setelah solusi ditemukan.
const CHUNK: u64 = 1 << 16;
const RETRY_MS: u64 = 3_000;
const HASHRATE_MS: u64 = 5_000;

struct Args {
    rpc: String,
    address: String,
    threads: usize,
    user: Option<String>,
}

fn usage() -> &'static str {
    "nex-miner — miner PoW NexChain (RPC-only, tanpa key)\n\
	 \n\
	 Pemakaian:\n\
	   nex-miner --address NxC... [opsi]\n\
	 \n\
	 Opsi:\n\
	   --address <alamat>   alamat penerima hadiah (wajib, NxC/NxS 43 char)\n\
	   --rpc <url>          endpoint JSON-RPC (default: NEX_RPC_URL atau\n\
	                        http://localhost:8000/rpc)\n\
	   --threads <n>        jumlah thread hashing (default: jumlah CPU logis)\n\
	   --user <nama>        username Basic Auth (atau env NEX_RPC_USER)\n\
	   -h, --help           tampilkan bantuan\n\
	 \n\
	 Password TIDAK lewat flag: pakai env NEX_RPC_PASS atau prompt tersembunyi.\n"
}

fn read_one_line(prompt: &str) -> Result<String, String> {
    print!("{prompt}");
    std::io::stdout()
        .flush()
        .map_err(|e| format!("gagal menulis prompt: {e}"))?;
    let mut line = String::new();
    std::io::stdin()
        .read_line(&mut line)
        .map_err(|e| format!("gagal membaca input: {e}"))?;
    Ok(line.trim().to_string())
}

fn next_value(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String, String> {
    args.next()
        .ok_or_else(|| format!("{flag} butuh nilai (pakai --help)"))
}

fn parse_args() -> Result<Args, String> {
    let mut rpc = std::env::var("NEX_RPC_URL").ok();
    let mut address: Option<String> = None;
    let mut threads: Option<usize> = None;
    let mut user = std::env::var("NEX_RPC_USER").ok();

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--rpc" => rpc = Some(next_value(&mut args, "--rpc")?),
            "--address" => address = Some(next_value(&mut args, "--address")?),
            "--threads" => {
                let raw = next_value(&mut args, "--threads")?;
                threads = Some(
                    raw.parse::<usize>()
                        .map_err(|_| format!("--threads harus angka, bukan {raw:?}"))?,
                );
            }
            "--user" => user = Some(next_value(&mut args, "--user")?),
            "-h" | "--help" => {
                print!("{}", usage());
                std::process::exit(0);
            }
            other => return Err(format!("argumen tidak dikenal: {other:?} (pakai --help)")),
        }
    }

    let address = match address {
        Some(value) => value,
        None if std::io::stdin().is_terminal() => {
            read_one_line("Alamat wallet (penerima hadiah) : ")?
        }
        None => return Err("--address wajib diisi (pakai --help)".to_string()),
    };
    if !is_valid_address(&address) {
        return Err(format!(
            "alamat tidak valid: {address:?} — harus diawali NxC/NxS dan 43 karakter"
        ));
    }

    if std::env::var("NEX_RPC_PASS").is_ok_and(|p| !p.is_empty()) && user.is_none() {
        return Err(
            "NEX_RPC_PASS diset tapi NEX_RPC_USER kosong — isi keduanya atau keduanya kosong"
                .to_string(),
        );
    }

    let default_threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    let threads = threads.unwrap_or(default_threads).clamp(1, 256);

    Ok(Args {
        rpc: rpc.unwrap_or_else(|| DEFAULT_RPC.to_string()),
        address,
        threads,
        user,
    })
}

/// Salinan `isValidAddress` node.
fn is_valid_address(address: &str) -> bool {
    (address.starts_with("NxC") || address.starts_with("NxS")) && address.len() == 43
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn format_rate(hashes_per_second: f64) -> String {
    if hashes_per_second >= 1_000_000.0 {
        format!("{:.2} MH/s", hashes_per_second / 1_000_000.0)
    } else {
        format!("{:.1} kH/s", hashes_per_second / 1_000.0)
    }
}

/// Tentukan nasib `getWork`: ulangi sebentar lagi, atau berhenti karena
/// konfigurasi auth tidak akan pernah berhasil dengan sendirinya (password
/// salah / tidak ada terminal untuk prompt) — loop tak berujung hanya
/// menyembunyikan salah ketik.
enum GetWorkError {
    Retry(String),
    Fatal(String),
}

/// Base64 standar untuk header Basic Auth (tanpa crate tambahan).
fn base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(b2 & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// Header `Authorization` siap pakai.
fn basic_auth(user: &str, password: &str) -> String {
    format!("Basic {}", base64(format!("{user}:{password}").as_bytes()))
}

#[derive(Debug)]
enum RpcError {
    Unauthorized,
    /// Kredensial tidak bisa didapat atau ditolak — mengulang tidak menolong.
    AuthFailed(String),
    Other(String),
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RpcError::Unauthorized => write!(f, "butuh kredensial node (401/403)"),
            RpcError::AuthFailed(message) => write!(f, "{message}"),
            RpcError::Other(message) => write!(f, "{message}"),
        }
    }
}

struct Rpc {
    agent: ureq::Agent,
    url: String,
    id: u64,
    auth: Option<String>,
    user: Option<String>,
}

impl Rpc {
    fn new(args: &Args) -> Self {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(15)))
            .http_status_as_error(false)
            .build()
            .into();
        // Password dari env dipakai lebih dulu supaya headless (systemd/VPS)
        // tidak pernah menunggu prompt. Tanpa itu, prompt hanya saat 401.
        let auth = match (
            args.user.as_deref(),
            std::env::var("NEX_RPC_PASS").ok().filter(|p| !p.is_empty()),
        ) {
            (Some(user), Some(password)) => Some(basic_auth(user, &password)),
            _ => None,
        };
        Self {
            agent,
            url: args.rpc.clone(),
            id: 0,
            auth,
            user: args.user.clone(),
        }
    }

    fn call(&mut self, method: &str, params: Option<Value>) -> Result<Value, RpcError> {
        self.id += 1;
        let mut body = json!({ "jsonrpc": "2.0", "id": self.id, "method": method });
        if let Some(params) = params {
            body["params"] = params;
        }

        let mut request = self
            .agent
            .post(&self.url)
            .header("content-type", "application/json");
        if let Some(auth) = &self.auth {
            request = request.header("authorization", auth);
        }

        let mut response = request
            .send_json(&body)
            .map_err(|e| RpcError::Other(format!("HTTP: {e}")))?;
        let status = response.status().as_u16();
        if status == 401 || status == 403 {
            return Err(RpcError::Unauthorized);
        }
        if status >= 400 {
            let text = response.body_mut().read_to_string().unwrap_or_default();
            return Err(RpcError::Other(format!("HTTP {status}: {}", text.trim())));
        }

        let value: Value = response
            .body_mut()
            .read_json()
            .map_err(|e| RpcError::Other(format!("respons bukan JSON: {e}")))?;
        if let Some(error) = value.get("error") {
            let message = error
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("JSON-RPC error");
            return Err(RpcError::Other(message.to_string()));
        }
        Ok(value.get("result").cloned().unwrap_or(Value::Null))
    }

    /// Kirim satu panggilan; kalau node menuntut kredensial dan kita belum
    /// punya, tanya sekali (username dari flag/env, password tersembunyi).
    fn call_auth(&mut self, method: &str, params: Option<Value>) -> Result<Value, RpcError> {
        match self.call(method, params.clone()) {
            Err(RpcError::Unauthorized) => {
                if self.auth.is_some() {
                    return Err(RpcError::AuthFailed(
                        "kredensial ditolak node (401/403) — periksa NEX_RPC_USER/NEX_RPC_PASS"
                            .to_string(),
                    ));
                }
                self.prompt_auth()?;
                match self.call(method, params) {
                    Err(RpcError::Unauthorized) => Err(RpcError::AuthFailed(
                        "kredensial ditolak node (401/403) — periksa NEX_RPC_USER/NEX_RPC_PASS"
                            .to_string(),
                    )),
                    other => other,
                }
            }
            other => other,
        }
    }

    fn prompt_auth(&mut self) -> Result<(), RpcError> {
        // Tanpa terminal, `read_line` langsung mengembalikan string kosong dan
        // prompt berulang selamanya — lebih baik berhenti dengan instruksi.
        if !std::io::stdin().is_terminal() {
            return Err(RpcError::AuthFailed(
				"node butuh kredensial tapi stdin bukan terminal — set NEX_RPC_USER dan NEX_RPC_PASS"
					.to_string(),
			));
        }
        println!("getWork butuh kredensial node");
        let user = match self.user.clone() {
            Some(user) => user,
            None => {
                let user = read_one_line("  username : ").map_err(RpcError::AuthFailed)?;
                if user.is_empty() {
                    return Err(RpcError::AuthFailed("username kosong".to_string()));
                }
                self.user = Some(user.clone());
                user
            }
        };
        let password = rpassword::prompt_password("  password : ")
            .map_err(|e| RpcError::AuthFailed(format!("gagal membaca password: {e}")))?;
        self.auth = Some(basic_auth(&user, &password));
        Ok(())
    }
}

#[derive(Debug)]
struct Work {
    job_id: String,
    payload: String,
    difficulty: f64,
    height: u64,
    expires_at: u64,
}

fn get_work(rpc: &mut Rpc, address: &str) -> Result<Work, GetWorkError> {
    let result = match rpc.call_auth("nex_getWork", Some(json!({ "minerAddress": address }))) {
        Ok(result) => result,
        Err(RpcError::AuthFailed(message)) => return Err(GetWorkError::Fatal(message)),
        Err(other) => return Err(GetWorkError::Retry(other.to_string())),
    };

    if result.get("status").and_then(Value::as_bool) != Some(true) {
        let reason = result
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("respons tidak lengkap");
        return Err(GetWorkError::Retry(reason.to_string()));
    }

    let field = |name: &str| {
        result
            .get(name)
            .cloned()
            .ok_or_else(|| format!("respons getWork tanpa {name}"))
    };

    Ok(Work {
        job_id: field("jobId")
            .map_err(GetWorkError::Retry)?
            .as_str()
            .ok_or_else(|| GetWorkError::Retry("jobId bukan string".to_string()))?
            .to_string(),
        payload: field("payload")
            .map_err(GetWorkError::Retry)?
            .as_str()
            .ok_or_else(|| GetWorkError::Retry("payload bukan string".to_string()))?
            .to_string(),
        difficulty: field("difficulty")
            .map_err(GetWorkError::Retry)?
            .as_f64()
            .ok_or_else(|| GetWorkError::Retry("difficulty bukan angka".to_string()))?,
        height: field("height")
            .map_err(GetWorkError::Retry)?
            .as_u64()
            .ok_or_else(|| GetWorkError::Retry("height bukan angka".to_string()))?,
        expires_at: field("expiresAt")
            .map_err(GetWorkError::Retry)?
            .as_u64()
            .ok_or_else(|| GetWorkError::Retry("expiresAt bukan angka".to_string()))?,
    })
}

fn submit(rpc: &mut Rpc, work: &Work, nonce: u64, hash_hex: &str) -> Result<(), String> {
    let result = rpc
        .call_auth(
            "nex_submitWork",
            Some(json!({ "jobId": work.job_id, "nonce": nonce, "hash": hash_hex })),
        )
        .map_err(|e| e.to_string())?;

    if result.get("status").and_then(Value::as_bool) == Some(true) {
        let height = result
            .get("height")
            .and_then(Value::as_u64)
            .unwrap_or(work.height);
        let hash = result
            .get("hash")
            .and_then(Value::as_str)
            .unwrap_or(hash_hex);
        println!("Blok #{height} DITERIMA: {hash}\n");
        Ok(())
    } else {
        let reason = result
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        Err(reason.to_string())
    }
}

struct Outcome {
    nonce: u64,
    hash: [u8; 32],
}

/// Cari satu nonce. Return `(solusi, total hash, detik)`.
fn mine(work: &Work, threads: usize) -> (Option<Outcome>, u64, f64) {
    let cursor = AtomicU64::new(0);
    let stop = AtomicBool::new(false);
    let done = AtomicBool::new(false);
    let hashes = AtomicU64::new(0);
    let solution: Mutex<Option<Outcome>> = Mutex::new(None);
    let started = Instant::now();

    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                let mut hasher = PowHasher::new(&work.payload);
                loop {
                    if stop.load(Ordering::Relaxed) {
                        return;
                    }
                    let start = cursor.fetch_add(CHUNK, Ordering::Relaxed);
                    if start >= MAX_NONCE {
                        stop.store(true, Ordering::Relaxed);
                        return;
                    }
                    let end = (start + CHUNK).min(MAX_NONCE);
                    let mut local = 0u64;
                    for nonce in start..end {
                        local += 1;
                        let digest = hasher.hash(nonce);
                        if meets_difficulty(&digest, work.difficulty) {
                            let mut guard = solution.lock().unwrap();
                            if guard.is_none() {
                                *guard = Some(Outcome {
                                    nonce,
                                    hash: digest,
                                });
                            }
                            drop(guard);
                            done.store(true, Ordering::Relaxed);
                            stop.store(true, Ordering::Relaxed);
                            hashes.fetch_add(local, Ordering::Relaxed);
                            return;
                        }
                    }
                    hashes.fetch_add(local, Ordering::Relaxed);
                }
            });
        }

        let mut last_report = Instant::now();
        let mut last_total = 0u64;
        while !done.load(Ordering::Relaxed) {
            if now_ms() >= work.expires_at {
                stop.store(true, Ordering::Relaxed);
                break;
            }
            if last_report.elapsed() >= Duration::from_millis(HASHRATE_MS) {
                let total = hashes.load(Ordering::Relaxed);
                let rate = (total - last_total) as f64 / last_report.elapsed().as_secs_f64();
                println!("  ... {} ({} hash)", format_rate(rate), total);
                last_report = Instant::now();
                last_total = total;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        stop.store(true, Ordering::Relaxed);
    });

    let total = hashes.load(Ordering::Relaxed);
    let elapsed = started.elapsed().as_secs_f64();
    (solution.into_inner().unwrap(), total, elapsed)
}

fn run() -> Result<(), String> {
    let args = parse_args()?;

    if !midstate::self_check() {
        return Err(
            "FATAL: hasher midstate tidak identik dengan SHA-256 rujukan — miner dihentikan."
                .to_string(),
        );
    }

    let mut rpc = Rpc::new(&args);

    let chain_id = rpc
        .call("nex_getChainId", None)
        .map_err(|e| format!("node tidak terjangkau ({}): {e}", args.rpc))?;
    let tip = rpc.call("nex_getRecentBlocks", Some(json!({ "count": 1 })));

    let tip_height = tip
        .ok()
        .and_then(|v| v.as_array().and_then(|a| a.first().cloned()))
        .and_then(|b| b.get("height").and_then(Value::as_u64));

    println!("NexChain miner (Rust)");
    println!("  address : {}", args.address);
    println!("  rpc     : {}", args.rpc);
    println!(
        "  auth    : {}",
        if rpc.auth.is_some() {
            "Basic dari NEX_RPC_USER/NEX_RPC_PASS"
        } else if args.user.is_some() {
            "Basic, password diminta saat node menolak"
        } else {
            "tanpa kredensial"
        }
    );
    println!("  threads : {}", args.threads);
    println!(
        "  node    : OK — chainId {}{}\n",
        chain_id
            .as_u64()
            .map(|id| id.to_string())
            .unwrap_or_else(|| "?".to_string()),
        tip_height
            .map(|h| format!(", tip #{h}"))
            .unwrap_or_default()
    );

    loop {
        let work = match get_work(&mut rpc, &args.address) {
            Ok(work) => work,
            Err(GetWorkError::Retry(reason)) => {
                eprintln!("getWork ditolak: {reason} — coba lagi {}s", RETRY_MS / 1000);
                std::thread::sleep(Duration::from_millis(RETRY_MS));
                continue;
            }
            Err(GetWorkError::Fatal(reason)) => return Err(reason),
        };

        println!(
            "Job {} | height #{} | difficulty {} bits",
            work.job_id, work.height, work.difficulty
        );

        let (solution, hashes, elapsed) = mine(&work, args.threads);
        let Some(solution) = solution else {
            println!("Job kedaluwarsa tanpa solusi — minta job baru...");
            continue;
        };

        let hash_hex = to_hex(&solution.hash);
        let rate = hashes as f64 / elapsed.max(0.001);
        println!(
            "Solusi: nonce {} hash {} ({:.1}s @ {}) — submit...",
            solution.nonce,
            hash_hex,
            elapsed,
            format_rate(rate)
        );

        if let Err(reason) = submit(&mut rpc, &work, solution.nonce, &hash_hex) {
            eprintln!("Ditolak: {reason} — ambil job baru...\n");
        }
        // Selesai atau ditolak: tip sudah bergerak, job lama basi → ulangi.
    }
}

fn main() {
    if let Err(message) = run() {
        eprintln!("{message}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_reference() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"user:pass"), "dXNlcjpwYXNz");
    }

    #[test]
    fn address_rule_matches_node() {
        let good_x = format!("NxC{}", "a".repeat(40));
        let good_s = format!("NxS{}", "b".repeat(40));
        assert_eq!(good_x.len(), 43);
        assert!(is_valid_address(&good_x));
        assert!(is_valid_address(&good_s));
        assert!(!is_valid_address("NxC"));
        assert!(!is_valid_address(&format!("NxC{}", "a".repeat(41))));
        assert!(!is_valid_address(&format!("NxA{}", "a".repeat(40))));
    }
}
