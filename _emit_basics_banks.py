# Emit php-backend/api/lib/SyncpediaBasicsBanks.php from extras + existing MCQs + aptitude.
from __future__ import annotations

import hashlib
import math
import random
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _gen_syncpedia_basics_banks import (  # noqa: E402
    DOMAINS,
    OUT,
    extras_ai,
    extras_cyber,
    extras_da,
    extras_java,
    extras_python,
    extras_vlsi,
    nearest,
    parse_existing,
    php_escape,
    q,
)
from _basics_new_domains import NEW_DOMAIN_EXTRAS  # noqa: E402

TARGET = 100
DIFFS = ("easy", "medium", "difficult")


def shuffle_row(row: tuple) -> tuple:
    diff, prompt, a, b, c, d, ans = row
    mapping = {"a": a, "b": b, "c": c, "d": d}
    texts = [mapping["a"], mapping["b"], mapping["c"], mapping["d"]]
    if len(set(texts)) < 4:
        return row
    seed = int(hashlib.md5(prompt.encode("utf-8")).hexdigest()[:8], 16)
    rng = random.Random(seed)
    order = texts[:]
    rng.shuffle(order)
    correct = mapping[ans]
    new_ans = "abcd"[order.index(correct)]
    return (diff, prompt, order[0], order[1], order[2], order[3], new_ans)


def pad_cyber() -> list:
    items = [
        ("difficult", "A DNS rebinding attack on a home router admin", "The attacker-controlled name later resolves to a private IP so a browser origin is trusted; neighbouring 'HTTPS stops rebinding'", "HSTS as rebinding", "CORS * as rebinding", "a hosts file as DNSSEC"),
        ("difficult", "OCSP stapling versus a hard-fail OCSP on a client", "Stapling avoids a client round-trip privacy leak; hard-fail can DoS if the responder is down — neighbouring 'must staple as optional always'", "CRL as OCSP", "pinning as OCSP", "CT as revocation"),
        ("difficult", "Passkeys / WebAuthn vs SMS OTP", "Phishing-resistant public-key assertion bound to origin; neighbouring SMS as equivalent MFA", "a TOTP screenshot as a passkey", "email OTP as WebAuthn", "a backup code as a resident key"),
        ("difficult", "A Kubernetes pod with hostNetwork and a privileged PSP equivalent", "The workload shares the node network/kernel attack surface; neighbouring 'namespace isolation as a VM'", "NetworkPolicy as hostNetwork", "seccomp as privileged", "a Service as a sandbox"),
        ("difficult", "SSRF via a webhook URL that hits metadata 169.254.169.254", "The server fetches attacker-chosen URLs with its IAM; neighbouring 'HTTPS makes SSRF local-only'", "a WAF as metadata", "DNS rebinding as the only SSRF", "an allow-list of IP literals as hostnames"),
        ("difficult", "Rowhammer / fault injection as a logical ACL bypass", "Hardware faults can flip bits in page tables; neighbouring 'ECC as a complete stop always'", "Spectre as Rowhammer", "NX as Rowhammer", "a canary as DRAM"),
        ("difficult", "A SAML unsigned assertion accepted because the SP checks only the transport", "The IdP message must be signed/encrypted per profile; neighbouring 'TLS to the SP as SAML integrity'", "OAuth as SAML", "a redirect as a signature", "entityID as a MAC"),
        ("difficult", "BCCs in an email that still lists recipients in a shared calendar invite", "Side channels leak membership; neighbouring 'Bcc as a cryptographic group'", "DKIM as Bcc", "SPF as calendar", "IMAP as Bcc"),
        ("difficult", "A CI job that checks out a PR and runs untrusted Makefile", "The runner is a confused deputy; neighbouring 'fork PRs as trusted because they are Git'", "CODEOWNERS as a sandbox", "a protected branch as a runner", "secrets as Git"),
        ("medium", "HSTS includeSubDomains without a preload plan for HTTP-only tools", "Subdomains are forced to HTTPS; neighbouring a single leaf as the tree", "HPKP as HSTS", "CAA as HSTS", "a 301 as includeSubDomains"),
        ("medium", "SameSite=Lax versus a top-level POST CSRF", "Lax sends cookies on top-level GET navigations; POST CSRF still needs Strict or a token", "None as Lax", "Secure as SameSite", "HttpOnly as CSRF"),
        ("medium", "A secret scanned in a container layer but not in HEAD", "Image history retains; neighbouring 'dockerignore as a history rewrite'", "a multi-stage as a scan", "BuildKit as secrets always", "ENV as BuildKit secret mounts"),
        ("medium", "Rate-limiting by IP behind a CDN that forwards X-Forwarded-For unsigned", "Attackers spoof the header; neighbouring the CDN connecting IP / signed header", "a CAPTCHA as XFF", "IPv6 as IPv4", "a cookie as XFF"),
        ("easy", "MFA fatigue / push bombing", "Repeated push prompts train the user to accept; neighbouring number-matching or phishing-resistant MFA", "SMS as fatigue-proof", "a password as push", "a backup code as number matching"),
        ("easy", "A unique salt stored next to a password hash", "Same password hashes differently per user; neighbouring a global pepper-only design", "AES of the password as a hash", "SHA-1 unsalted as salt", "Base64 as a KDF"),
        ("easy", "Least privilege for a backup service account", "Only the objects it must read/write; neighbouring Domain Admin as backup", "a daily password change as least privilege", "MFA as a file ACL", "a jump host as a privilege"),
        ("easy", "A security.txt and a vulnerability disclosure policy", "A coordinated path to report; neighbouring a bug bounty as required", "CVE as security.txt", "a WAF as a policy", "robots.txt as disclosure"),
        ("easy", "Patch cadence versus virtual patching on a WAF", "The WAF is a compensating control, not a substitute for the vendor fix", "virtual patch as a CVE close", "an IDS as a patch", "EOL software as patched if WAFed"),
        ("medium", "A memory-safe rewrite of a parser versus a fuzzer-only plan", "The class of spatial bugs shrinks; neighbouring 'AFL as memory safety'", "a canary as safety", "ASLR as a language", "a WAF as a parser"),
        ("difficult", "OIDC mixed up authorization code with a public client's secretless token endpoint", "PKCE + exact redirect URI; neighbouring implicit fragment as OIDC-for-SPA", "ROP as OIDC", "a nonce as PKCE", "state as a code_verifier"),
    ]
    return [nearest(d, t, a, b, c, e, "a") for d, t, a, b, c, e in items]


def pad_da() -> list:
    items = [
        ("difficult", "Simpson's paradox in an admissions dashboard", "A reversal after pooling; neighbouring 'the aggregate is always the causal effect'", "Berkson's paradox as Simpson always", "ecological fallacy as Simpson", "a collider as pooling"),
        ("difficult", "A target-leak feature that is a function of the label", "The model cheats; neighbouring a timestamp after the outcome as a valid predictor", "regularisation as leak-proof", "a high AUC as no leak", "SHAP as a leak detector always"),
        ("difficult", "A/B test with interference (network effects)", "SUTVA fails; neighbouring a user-level randomisation as enough on a social graph", "a CUPED as SUTVA", "a longer test as interference", "a Bonferroni as a network"),
        ("difficult", "Multiple-look sequential testing without alpha spending", "Type I inflation; neighbouring p=0.049 on day 3 as a pre-registered result", "power as alpha", "a Bayesian posterior as optional stopping-proof always", "a holdout as peeking"),
        ("difficult", "A join that silently drops unmatched conversions (inner join)", "Selection bias; neighbouring a left join with explicit missingness", "an outer join as inner", "a union as a join", "a distinct as a join key"),
        ("medium", "Cardinality of a COUNT DISTINCT on a sampled table", "HyperLogLog/approx and sampling bias; neighbouring COUNT(*) as distinct", "a unique constraint as HLL", "a primary key as approximate", "a bitmap as exact always"),
        ("medium", "Slowly changing dimension Type 2", "New row on change with validity window; neighbouring Type 1 overwrite as history", "Type 0 as Type 2", "a snapshot dump as SCD2 always", "a fact as a dimension"),
        ("medium", "A fact table at the wrong grain", "Fan-out when joining; neighbouring a degenerate dimension as grain", "a bridge as grain always", "a junk dimension as a fact", "an accumulated snapshot as grain"),
        ("medium", "Train/test split that is not grouped by user", "Leakage of the same person; neighbouring a random row split as i.i.d. people", "k-fold as grouped always", "a time split as a user", "stratify as grouping"),
        ("medium", "Heteroskedasticity in a linear model of spend", "Variance grows with mean; neighbouring OLS SEs as always valid", "a log as always homoskedastic", "WLS as optional", "robust SE as a bias fix"),
        ("easy", "A primary key versus a business key", "The surrogate is stable; the natural key can change — neighbouring them as identical", "a UUID as a natural key always", "an email as immutable", "a composite as a surrogate"),
        ("easy", "NULL in SQL three-valued logic", "UNKNOWN is not FALSE; neighbouring NULL = NULL as true", "COALESCE as optional", "IS NULL as = NULL", "an empty string as NULL always"),
        ("easy", "A window function versus GROUP BY", "Rows are retained with an analytic; neighbouring GROUP BY as a window", "DISTINCT as OVER", "HAVING as PARTITION", "a CTE as a window"),
        ("easy", "A left join that filters the right table in WHERE", "It becomes an inner join; neighbouring the predicate in ON", "a right join as left", "a semi-join as WHERE", "a cross join as ON"),
        ("easy", "A KPI tree versus a single vanity metric", "Leading/lagging with owners; neighbouring DAU as the strategy", "an OKR as a vanity", "a North Star as unowned", "a dashboard as a tree"),
        ("difficult", "Post-treatment bias from controlling on a mediator", "The causal effect is blocked; neighbouring a DAG as optional", "a confounder as a mediator", "a collider as a control", "a propensity as a mediator"),
        ("difficult", "Concept drift after a pricing change", "P(X,y) shifts; neighbouring retraining on old prices as enough", "covariate shift as concept always", "a new feature as drift", "a larger model as stationarity"),
        ("difficult", "A Looker explore that exposes row-level PII without access filters", "Authorisation at the BI layer; neighbouring a warehouse grant as the explore", "a hash of email as k-anonymity", "a row limit as RLS", "an explore as a view grant"),
        ("medium", "Late-arriving facts versus a watermark", "The pipeline must reopen windows; neighbouring an at-least-once drop of late rows", "a watermark as a PK", "an event-time as processing-time", "a batch as late"),
        ("medium", "A ratio of two sums versus an average of ratios", "They answer different questions; neighbouring them as identical", "a weighted mean as unweighted", "a median of ratios as a ratio of sums", "Simpson as a ratio"),
    ]
    return [nearest(d, t, a, b, c, e, "a") for d, t, a, b, c, e in items]


def pad_ai() -> list:
    items = [
        ("difficult", "A constitutional classifier that is itself jailbreakable", "Stacked defences still have residual; neighbouring 'a constitution as a proof'", "RLHF as a constitution", "a system prompt as a proof", "a filter as a model"),
        ("difficult", "Unlearning a datum with gradient ascent on one example", "Approximate and attackable; neighbouring GDPR delete as certified unlearning", "fine-tune as unlearning always", "a filter as unlearning", "quantisation as unlearning"),
        ("difficult", "A world model that is trained on internet video", "Observation bias and embodiment gap; neighbouring 'next-frame as a physics engine'", "a game engine as the web", "a tokenizer as a world", "a replay buffer as video"),
        ("difficult", "Annotation guidelines that disagree on a 40% slice", "The task is under-specified; neighbouring more annotators as a fix of the spec", "IAA as the guideline", "a majority as a gold always", "a model as a guideline"),
        ("difficult", "A retrieval index poisoned with adversarial passages", "The generator is steered; neighbouring BM25 as immune", "a re-ranker as a sanitiser always", "an embedding as a signature", "a citation as integrity of the index"),
        ("medium", "Beam search versus sampling at T>0", "Beam is MAP-ish; sampling explores; neighbouring them as identical quality", "greedy as beam", "top-k as beam always", "a length penalty as T"),
        ("medium", "Speculative decoding", "A draft model proposes tokens a target verifies; neighbouring a smaller model as the target", "quantisation as speculative", "MoE as draft always", "a cache as a draft"),
        ("medium", "Grouped-query attention", "Fewer KV heads than Q; neighbouring MHA as GQA always", "MQA as MHA", "sliding window as GQA", "RoPE as GQA"),
        ("medium", "A preference model over-optimised until it hacks the reward", "Goodhart; neighbouring KL as optional", "SFT as RLHF", "a constitution as reward hacking", "DPO as immune always"),
        ("medium", "Chain-of-thought that is not faithful to the logits", "The text can be post-hoc; neighbouring CoT as the algorithm", "a scratchpad as faithful always", "a tool call as CoT", "a hidden state as a sentence"),
        ("easy", "Precision versus recall on a rare class", "Precision is among predicted positives; recall among true positives", "accuracy as precision on imbalance", "F1 as accuracy", "AUROC as a threshold"),
        ("easy", "A confusion matrix", "Counts of TP/FP/FN/TN at a threshold; neighbouring a loss as a matrix", "a ROC as a matrix", "a PR curve as TP", "calibration as confusion"),
        ("easy", "Overfitting versus underfitting", "Train/test gap versus high bias on both; neighbouring dropout as data", "a larger net as underfit always", "early stop as more epochs", "batch norm as overfit always"),
        ("easy", "A validation split versus a test split", "Tune on val; report once on test; neighbouring peeking at test as val", "k-fold as test", "a seed as a split", "augmentation as a split"),
        ("easy", "Token versus word versus byte", "Subword tokens are not words; neighbouring a whitespace split as BPE", "a character as a wordpiece always", "UTF-8 as a token always", "a BOS as a word"),
        ("difficult", "A multimodal model that ignores the image (text shortcut)", "Unimodal collapse; neighbouring CLIP as a guarantee of use", "a caption as vision", "an alt-text as pixels", "a higher res as grounding"),
        ("difficult", "Membership inference on a fine-tuned medical LLM", "Train points can be detected; neighbouring 'we used HIPAA so no MI'", "DP-SGD as optional", "a ToS as MI", "a watermark as membership"),
        ("difficult", "A tool-using agent with unbounded bash", "The model can exfiltrate; neighbouring a sandbox and allow-list", "a system prompt as a sandbox", "a ToS as bash", "a confirmation as a jail"),
        ("medium", "Mixture-of-experts load imbalance", "A few experts get all tokens; neighbouring auxiliary losses / capacity", "dropout as MoE", "a larger hidden as experts", "GQA as MoE"),
        ("medium", "KV-cache eviction in a long agent trace", "Forgetting tool results; neighbouring infinite context as free", "a summary as eviction always lossless", "RAG as KV", "a sliding window as a transcript"),
    ]
    return [nearest(d, t, a, b, c, e, "a") for d, t, a, b, c, e in items]


def pad_java() -> list:
    items = [
        ("difficult", "A Hibernate Second-level cache of a mutable entity across nodes without invalidation", "Stale reads; neighbouring a local cache as a cluster", "ehcache as a transaction", "a query cache as L2 always", "Redis as Hibernate"),
        ("difficult", "Project Loom structured concurrency leaking a scope", "Tasks must join; neighbouring virtual threads as fire-and-forget", "an Executor as a StructuredTaskScope", "a daemon as structured", "a Future as a scope"),
        ("difficult", "A native memory leak via DirectByteBuffer without Cleaner reachability", "Off-heap is not the Java heap dump story; neighbouring -Xmx as direct", "GC as direct always", "a MappedByteBuffer as heap", "Unsafe as a Cleaner"),
        ("difficult", "Spring Cloud LoadBalancer with a stale service registry", "Retry/backoff and health; neighbouring a hardcoded VIP as discovery", "Eureka as DNS always", "Ribbon as optional", "a gateway as a registry"),
        ("difficult", "A JDBC tx around an HTTP call then a second SQL", "Holds a connection during I/O; neighbouring a short tx then HTTP", "REQUIRES_NEW as HTTP", "Open Session as HTTP", "a reactive client as a tx"),
        ("medium", "GraalVM native-image missing reflection config", "Reachability metadata; neighbouring JIT as native", "a fat jar as native", "an agent as optional always", "Spring AOT as reflection-free always"),
        ("medium", "Jackson default typing enabled", "Polymorphic gadget risk; neighbouring ObjectMapper as safe defaults", "Gson as Jackson", "a record as typing", "Afterburner as typing"),
        ("medium", "A Flyway migration checksum mismatch after a hotfix in prod", "Never edit applied scripts; neighbouring a repair without review", "Liquibase as Flyway always", "a baseline as a checksum", "hibernate.ddl-auto as Flyway"),
        ("medium", "Micrometer cardinality explosion on a user-id tag", "Metric series unbounded; neighbouring a bounded set of tags", "a log as a metric", "a trace as a tag", "a histogram as cardinality"),
        ("medium", "A RestClient timeout of 0 as infinite", "Document defaults; neighbouring a library default as 0=fast", "connect as read", "a circuit as a timeout", "a retry as 0"),
        ("easy", "A Java enum versus a bunch of public static final ints", "Closed set with type safety; neighbouring an int as an enum", "a sealed class as an int", "a record as an enum always", "a boolean as a three-state enum"),
        ("easy", "ArrayList versus LinkedList for indexed get", "ArrayList is O(1) get; neighbouring LinkedList as always faster inserts at the end", "a Vector as ArrayList", "CopyOnWrite as LinkedList", "a HashMap as a list"),
        ("easy", "checked IOException on a REST controller", "Map to a problem+json; neighbouring stack traces as the body", "RuntimeException as IOException", "Error as a 400", "a 204 as an error"),
        ("easy", "A DTO versus an entity in a controller signature", "API shape versus persistence; neighbouring @RequestBody Entity as a DTO", "a Map as a contract", "JSON as JPA", "a record as an entity always"),
        ("easy", "maven wrapper versus a globally installed JDK mismatch", "Reproducible builds; neighbouring 'it works on my machine'", "a fat JDK as wrapper", "Gradle as Maven always", "a parent POM as a toolchains"),
        ("difficult", "Virtual-thread pinning on a synchronized cache", "Replace with ReentrantLock / java.util.concurrent; neighbouring 'Loom fixes all locks'", "a ThreadLocal as pinning", "synchronized as never pinning on JDK 21", "a native call as unpinned"),
        ("difficult", "A Kafka consumer that commits before the DB write", "At-least-once inversion; neighbouring transactional outbox / EOS", "auto-commit as EOS", "a retry as a commit", "an idempotent producer as a consumer commit"),
        ("difficult", "Spring @Cacheable on a private method", "Self-invocation; neighbouring AspectJ as the default", "CGLIB as private", "a protected as public always", "Redis as the proxy"),
        ("medium", "A health indicator that queries a primary under load", "Liveness vs readiness; neighbouring /health hitting the DB always", "a ping as a join", "Actuator as readiness", "a 200 as liveness of dependents"),
        ("medium", "OpenAPI generated clients ignoring 429 Retry-After", "Backoff; neighbouring a tight loop as REST", "a 500 as 429", "a circuit as Retry-After always", "a larger pool as 429"),
    ]
    return [nearest(d, t, a, b, c, e, "a") for d, t, a, b, c, e in items]


def pad_python() -> list:
    items = [
        ("difficult", "A gunicorn sync worker holding the GIL on CPU JSON", "Use async/gevent/process workers; neighbouring more threads as CPU", "uvicorn as gunicorn sync", "a greenlet as the GIL", "orjson as a process"),
        ("difficult", "Django ATOMIC_REQUESTS plus a long external HTTP", "Holds a DB lock/connection; neighbouring a short transaction", "select_for_update as HTTP", "autocommit as ATOMIC", "a Celery task as a request tx always"),
        ("difficult", "A multiprocessing Manager dict as a hot lock", "Better shared memory / Redis; neighbouring a Manager as free", "a Queue as a dict", "fork as Manager", "a Lock as GIL"),
        ("difficult", "pandas eval of a user expression", "Arbitrary code paths; neighbouring query with a restricted engine", "numexpr as a sandbox always", "eval as query", "a Python engine as safe"),
        ("difficult", "Starlette UploadFile on a tiny /tmp with a 2 GB file", "Spool to disk/DoS; neighbouring a size cap and streaming", "SpooledTemporaryFile as infinite", "a form as a cap", "nginx as the app"),
        ("medium", "mypy --strict versus ignore comments on a boundary", "Typed core, adapters at edges; neighbouring ignore as the style", "pyright as mypy always", "a cast as a check", "Any as strict"),
        ("medium", "ruff versus a subset of flake8 plugins", "One linter; neighbouring pylint as ruff always", "black as ruff", "isort as mypy", "a pre-commit as CI"),
        ("medium", "A Django N+1 in a DRF SerializerMethodField", "Prefetch in the view; neighbouring select_related on a M2M", "only() as prefetch", "defer as a join", "a property as a join"),
        ("medium", "Celery canvas with a chord of 10k tasks", "Chord is heavy; neighbouring a group with a reducer queue", "a chain as a chord", "acks as canvas", "a worker as a chord"),
        ("medium", "SQLAlchemy 2.0 style versus legacy Query", "select() is the 2.0 way; neighbouring Session.query as 2.0", "a Core as an ORM", "an Engine as a Session", "text() as 2.0 always"),
        ("easy", "list.sort versus sorted", "In-place versus new list; neighbouring them as identical objects", "a tuple as sort", "reversed as sort", "a key as in-place always"),
        ("easy", "a set versus a list for membership", "Average O(1) versus O(n); neighbouring a list as a hash", "a dict as a set always", "a tuple as a set", "a deque as a hash"),
        ("easy", "f-strings versus % formatting", "f-strings are the modern default; neighbouring pickle as format", "str.format as eval", "a Template as f", "an f-string as a locale always"),
        ("easy", "pathlib.Path versus os.path.join", "Object API; neighbouring a str as a Path always", "a bytes path as Path on all OS", "resolve as join", "cwd as Path"),
        ("easy", "pytest fixtures versus setup_method", "Composable dependency injection; neighbouring unittest as pytest fixtures", "a conftest as a test", "a mock as a fixture always", "parametrize as a fixture"),
        ("difficult", "An asyncio lock forgotten across tasks sharing a session", "Serialise or one session per task; neighbouring the GIL as a DB lock", "a threading.Lock in async as the loop", "a Queue as a session", "a pool as a lock"),
        ("difficult", "torch DataLoader num_workers fork after CUDA init", "Spawn/fork hazards; neighbouring workers as free after cuda", "pin_memory as fork", "a generator as workers", "a Dataset as CUDA"),
        ("difficult", "A FastAPI streaming response that never closes the generator", "Cancel/finally; neighbouring a StreamingResponse as always closed", "yield as close", "a BackgroundTask as a generator", "gzip as a stream"),
        ("medium", "poetry export to requirements without hashes in prod", "Reproducibility; neighbouring a range as a lock", "pip freeze as poetry", "conda as hashes", "a wheel as a lock"),
        ("medium", "Django CSRF on a JSON SPA with SessionAuthentication", "Need CSRF for cookie sessions; neighbouring JWT header as session CSRF", "SameSite as CSRF-complete", "CORS as CSRF", "a Bearer as a cookie"),
    ]
    return [nearest(d, t, a, b, c, e, "a") for d, t, a, b, c, e in items]


def pad_vlsi() -> list:
    items = [
        ("difficult", "A hold fix that inserts a buffer on a path that is also a max-delay critical", "Trade setup; neighbouring a buffer as free slack", "a downsize as hold always", "useful skew as a buffer", "OCV as a buffer"),
        ("difficult", "A voltage-domain crossing without a synchroniser because 'the clocks are related'", "Related is not synchronous; neighbouring an MCP as a CDC", "a generated clock as related always", "a PLL as a sync", "a divider as a 2-flop"),
        ("difficult", "EM signoff with RMS-only and no peak for a wide bus", "Peak/self-heat matter; neighbouring RMS as complete", "IR as EM", "a via array as EM-free", "a width as peak"),
        ("difficult", "A scan chain with a lockup missing between domains at shift", "Hold in shift; neighbouring a functional hold as shift", "OCC as lockup", "an ICG as lockup", "compression as lockup"),
        ("difficult", "Formal equivalence failing on a floating-point FPU after retiming", "Need constraints/black-box; neighbouring 'LEC always proves FP'", "STA as LEC", "a testbench as equivalence", "a GDS as RTL"),
        ("medium", "A virtual clock for IO budgeting", "External interface clock; neighbouring create_clock on every pad flop as virtual", "a generated clock as virtual always", "set_input_delay as optional", "a false path as a virtual"),
        ("medium", "Set_case_analysis on a scan enable", "Modes; neighbouring a constant as all modes", "a false path as case", "MCP as case", "a derate as case"),
        ("medium", "A don't-touch on a clock-gate cell", "Preserve ICG; neighbouring opt as free to dissolve ICG", "a size_only as don't-touch always", "a hierarchical pin as ICG", "a liberty as don't-touch"),
        ("medium", "Decap cell placement versus a density DRC", "Fill/decap trade; neighbouring decap as routing", "a filler as decap always", "a well tap as decap", "a strap as a cell"),
        ("medium", "A 6T SRAM bitcell versus a standard-cell latch", "Foundry bitcell/array; neighbouring a latch as a bitcell", "a DRAM as 6T", "a CAM as 6T always", "a ROM as a bitcell"),
        ("easy", "RTL lint versus a synthesis warning", "Lint is style/CDC/synthesis-readiness; neighbouring STA as lint", "a testbench as lint", "formal as lint always", "a waveform as lint"),
        ("easy", "A testbench that uses #delays in synthesizable RTL", "Simulation-only; neighbouring #5 as a clock in silicon", "an always_ff as #delay", "an initial as silicon", "a force as RTL"),
        ("easy", "Floorplan versus placement", "Macros/IO/power plan then std-cell; neighbouring them as identical", "CTS as floorplan", "route as floorplan", "a DEF as a netlist"),
        ("easy", "A timing exception documentation", "Signoff needs the why; neighbouring an undocumented false path as signoff", "a derate as a comment", "SDC as optional", "a waiver as silicon"),
        ("easy", "A foundry DRC manual versus a generic textbook CMOS", "The PDK wins; neighbouring lambda rules as 7 nm", "a MOSIS as FinFET", "a SCMOS as GAA", "a magic layout as a foundry"),
        ("difficult", "A 3D IC without a thermal analysis of the stack", "Hotspot in a buried die; neighbouring a 2D sink as the stack", "IR as thermal", "a TIM as optional", "a corner as a 3D map"),
        ("difficult", "Path-margin variation with POCV on a reconvergent fanout", "Statistical combination; neighbouring a worst-derate as POCV", "AOCV as POCV always", "CRPR as POCV", "a Monte-Carlo of one gate as the path"),
        ("difficult", "A DFT compression signature mismatch only on ATE, not in simulation", "X-sources, load-board, voltage; neighbouring 'sim is silicon'", "a MISR as ATE", "a probe as a sim", "OCC as a board"),
        ("medium", "A clock mesh versus an H-tree at a large GPU-class die", "Mesh for skew; neighbouring an H-tree as always lower power", "a PLL as a mesh", "gating as a mesh", "a DLL as CTS"),
        ("medium", "Retention flops versus always-on island", "State keep vs power domain; neighbouring them as identical", "isolation as retention", "a header as a flop", "UPF as a cell"),
    ]
    return [nearest(d, t, a, b, c, e, "a") for d, t, a, b, c, e in items]


PADS = {
    "cyber_sec": pad_cyber,
    "data_analytics": pad_da,
    "ai": pad_ai,
    "java_fullstack": pad_java,
    "python_fullstack": pad_python,
    "vlsi": pad_vlsi,
}

EXTRAS = {
    "cyber_sec": extras_cyber,
    "data_analytics": extras_da,
    "ai": extras_ai,
    "java_fullstack": extras_java,
    "python_fullstack": extras_python,
    "vlsi": extras_vlsi,
}


DOMAIN_TARGETS = {"medium": 40, "hard": 30, "expert": 15, "scenario": 15}


def _dedupe(rows: list) -> list:
    seen: set[str] = set()
    out: list[tuple] = []
    for row in rows:
        prompt = row[1]
        if prompt in seen:
            continue
        seen.add(prompt)
        out.append(row)
    return out


def _remap_legacy_domain(rows: list) -> list:
    """easy→medium, medium→hard, difficult split into 15 expert + 15 scenario."""
    difficult = sorted((r for r in rows if r[0] == "difficult"), key=lambda r: r[1])
    out: list[tuple] = []
    for row in rows:
        if row[0] == "difficult":
            continue
        diff = {"easy": "medium", "medium": "hard"}.get(row[0], row[0])
        out.append((diff, *row[1:]))
    for i, row in enumerate(difficult):
        if i < 15:
            diff = "expert"
        elif i < 30:
            diff = "scenario"
        else:
            diff = "expert"
        out.append((diff, *row[1:]))
    return out


def fit_domain(rows: list, label: str) -> list:
    rows = _dedupe(rows)
    if any(r[0] in ("easy", "difficult") for r in rows):
        rows = _dedupe(_remap_legacy_domain(rows))
    by = {k: [] for k in DOMAIN_TARGETS}
    for row in rows:
        diff = row[0] if row[0] in by else "medium"
        by[diff].append((diff, *row[1:]))
    chosen = {}
    surplus: list[tuple] = []
    for key, target in DOMAIN_TARGETS.items():
        chosen[key] = by[key][:target]
        surplus.extend(by[key][target:])
    for key, target in DOMAIN_TARGETS.items():
        while len(chosen[key]) < target and surplus:
            donor = surplus.pop(0)
            chosen[key].append((key, *donor[1:]))
    out: list[tuple] = []
    for key, target in DOMAIN_TARGETS.items():
        if len(chosen[key]) != target:
            raise SystemExit(f"{label} {key} {len(chosen[key])} (need {target})")
        out.extend(chosen[key])
    if len(out) != TARGET:
        raise SystemExit(f"{label} size {len(out)}")
    return [shuffle_row(r) for r in out]


def _fmt_num(x) -> str:
    if isinstance(x, float):
        if abs(x - round(x)) < 1e-9:
            return str(int(round(x)))
        s = f"{x:.4f}".rstrip("0").rstrip(".")
        return s
    return str(x)


def _pack(diff: str, prompt: str, correct, wrongs) -> tuple:
    c = _fmt_num(correct) if not isinstance(correct, str) else correct
    w = []
    seen = {c}
    for x in wrongs:
        t = _fmt_num(x) if not isinstance(x, str) else x
        if t in seen:
            continue
        seen.add(t)
        w.append(t)
        if len(w) == 3:
            break
    k = 1
    while len(w) < 3:
        if isinstance(correct, (int, float)):
            cand = _fmt_num(correct + k)
        else:
            cand = f"{c}′" if k == 1 else f"{c} ({k})"
        if cand not in seen:
            w.append(cand)
            seen.add(cand)
        k += 1
    return shuffle_row(q(diff, prompt, c, w[0], w[1], w[2], "a"))


def aptitude_bank() -> list:
    rows: list[tuple] = []

    # Concept (nearest-meaning) — same specialist flavour as domain banks
    concept = [
        ("easy", "A percentage", "A ratio of a quantity to a base of 100; neighbouring a percentage-point as a percent of a percent", "A percentage-point change as a multiplicative percent", "A basis point as 1%", "A ratio as always greater than 1"),
        ("easy", "Simple interest", "Interest on the original principal only; neighbouring compound interest as SI", "CI as linear in time always", "A discount as SI", "A ratio as interest"),
        ("easy", "Compound interest", "Interest on accumulated amount; neighbouring SI as CI for any t", "A linear function of t always", "A discount as CI", "APR as always equal to APY"),
        ("easy", "A ratio a:b", "A comparison of two quantities of the same kind; neighbouring a difference as a ratio", "A percentage as a:b always", "A rate as a pure number without units always", "A fraction as a difference"),
        ("easy", "An average (arithmetic mean)", "Sum divided by count; neighbouring a median as the mean always", "A mode as the mean", "A weighted mean as an unweighted mean", "A geometric mean as AM always"),
        ("easy", "Profit percent on cost", "(SP−CP)/CP × 100; neighbouring profit on SP as the same", "Markup as margin always", "Discount as profit", "VAT as profit"),
        ("easy", "A permutation nPr", "Ordered selections; neighbouring a combination as a permutation", "nCr as nPr", "n! as nPr always", "A circular permutation as nPr always"),
        ("easy", "A combination nCr", "Unordered selections; neighbouring nPr as nCr", "n! as nCr", "A permutation with repetition as nCr", "A derangement as nCr"),
        ("easy", "Speed", "Distance over time; neighbouring acceleration as speed", "Velocity as always scalar speed", "Pace as speed always without inversion", "A rate of work as speed of a particle"),
        ("easy", "Relative speed of two bodies in opposite directions", "Sum of speeds; neighbouring same direction as opposite", "Difference as opposite always", "Product as relative", "Average of speeds as relative always"),
        ("medium", "A successive percentage change of +x% then −x%", "Net factor (1+x)(1−x)=1−x², a loss; neighbouring them as cancelling", "A +x then −x as identity", "A percentage-point as this product", "An average of +x and −x as the net"),
        ("medium", "Alligation", "A weighted-mean rule for mixing two concentrations; neighbouring an unweighted average of percents", "A ratio of prices as always the mix ratio without weights", "A harmonic mean as alligation always", "A geometric mean as the mix"),
        ("medium", "Time and work: A is twice as efficient as B", "A takes half B's time for the same job; neighbouring twice the time as twice the efficiency", "Rates add when they work together", "A's rate as B's time", "A harmonic of times as a sum of times"),
        ("medium", "Pipes and cisterns with a leak", "Net rate = fill − leak; neighbouring adding times as rates", "A negative pipe as a fill", "A closed pipe as a leak", "Capacities as rates"),
        ("medium", "Boats and streams", "Downstream = b+c, upstream = b−c; neighbouring multiplying speeds", "A still-water speed as a current", "A harmonic of up/down as always b", "A ratio of times as a ratio of distances always without current"),
        ("medium", "The difference CI − SI for 2 years", "P(r/100)²; neighbouring 3-year formula as 2-year", "2 × SI as the difference", "P r t as CI−SI", "A simple 2Pr as the difference"),
        ("medium", "A weighted average", "Weights multiply values then divide by total weight; neighbouring an unweighted mean of the same numbers", "A median as a weighted mean", "A mode as weights", "A harmonic mean as AM of weights"),
        ("medium", "Conditional probability P(A|B)", "P(A∩B)/P(B); neighbouring P(A) as P(A|B) always", "Independence as P(A|B)=P(A)P(B)", "P(B|A) as P(A|B)", "A Bayes inversion as optional always"),
        ("medium", "Independent events", "P(A∩B)=P(A)P(B); neighbouring mutually exclusive as independent", "Disjoint as independent for P>0", "A partition as independence", "A Bayes factor as independence"),
        ("medium", "nPr / nCr identity", "nPr = nCr × r!; neighbouring nCr = nPr × r!", "nPr = nCr / r!", "(n+r)Cr as nPr", "n! as nCr × nPr"),
        ("difficult", "A harmonic mean of speeds for a round trip at v1 and v2 on equal distances", "2/(1/v1+1/v2); neighbouring AM of speeds as the average speed", "GM as the round-trip speed always", "A difference of speeds as the mean", "A time-average as a distance-average always"),
        ("difficult", "Bayes' theorem as inverting a likelihood", "P(H|E) ∝ P(E|H)P(H); neighbouring P(E|H) as P(H|E)", "A prior of 1 as optional", "A likelihood as a posterior always", "A p-value as a posterior"),
        ("difficult", "Expected value of a discrete random variable", "Sum x P(x); neighbouring a mode as the expectation", "A median as E[X] always", "A sample mean of n=1 as the law of large numbers", "A variance as an expectation of x"),
        ("difficult", "Variance as E[X²]−(E[X])²", "Second moment minus square of first; neighbouring SD as variance", "A mean absolute deviation as variance", "A range as variance", "A covariance of X with X as 0"),
        ("difficult", "A circular permutation of n distinct objects", "(n−1)!; neighbouring n! as circular", "nPn as circular", "nCr as circular", "2n as circular"),
        ("difficult", "Inclusion-exclusion for two sets", "|A∪B|=|A|+|B|−|A∩B|; neighbouring adding sizes as a union always", "A product as a union", "A difference as a union", "A symmetric difference as a union always"),
        ("difficult", "Logarithms: log_b (xy)", "log_b x + log_b y; neighbouring a product of logs", "log_b(x+y) as a sum of logs", "a change of base as a product", "ln as log10 always"),
        ("difficult", "An arithmetic progression nth term", "a+(n−1)d; neighbouring a geometric nth term as AP", "ar^{n−1} as AP", "n(n+1)/2 as the nth term", "a harmonic nth as AP"),
        ("difficult", "Sum of an AP", "n/2 × (2a+(n−1)d); neighbouring n×last as the sum always", "A GP sum as AP", "n² as AP sum always", "a+(n−1)d as the sum"),
        ("difficult", "Remainder theorem", "f(a) is the remainder of f(x)÷(x−a); neighbouring a factor as a remainder of 1", "f(0) as always the remainder at a", "The quotient as the remainder", "A synthetic division as a factor always"),
    ]
    for item in concept:
        rows.append(shuffle_row(nearest(item[0], item[1], item[2], item[3], item[4], item[5], "a")))

    def add(diff, prompt, correct, wrongs):
        rows.append(_pack(diff, prompt, correct, wrongs))

    # Easy computed
    add("easy", "What is 15% of 240?", 36, [24, 30, 40])
    add("easy", "What is 12.5% of 480?", 60, [48, 72, 80])
    add("easy", "Express 3/8 as a percentage.", "37.5%", ["38%", "35%", "40%"])
    add("easy", "A number increased by 20% becomes 180. The original number is:", 150, [144, 160, 120])
    add("easy", "A number decreased by 25% becomes 90. The original number is:", 120, [115, 100, 135])
    add("easy", "The ratio 2:5. The first quantity as a percent of the second is:", "40%", ["25%", "2.5%", "20%"])
    add("easy", "Divide ₹840 in the ratio 3:4. The larger share is:", 480, [360, 420, 560])
    add("easy", "The average of 12, 18, 24 and 30 is:", 21, [20, 22, 24])
    add("easy", "The average of first 10 natural numbers is:", 5.5, [5, 6, 10])
    add("easy", "CP = ₹400, SP = ₹460. Profit percent is:", "15%", ["12%", "16%", "20%"])
    add("easy", "CP = ₹250, loss = 8%. SP is:", 230, [242, 200, 258])
    add("easy", "SI on ₹2000 at 10% p.a. for 3 years is:", 600, [500, 660, 700])
    add("easy", "A car covers 180 km in 3 hours. Average speed is:", "60 km/h", ["54 km/h", "90 km/h", "45 km/h"])
    add("easy", "A man walks 4 km/h for 2.5 hours. Distance is:", "10 km", ["8 km", "6.5 km", "12 km"])
    add("easy", "HCF of 24 and 36 is:", 12, [6, 8, 18])
    add("easy", "LCM of 8 and 12 is:", 24, [16, 20, 96])
    add("easy", "The next term of 2, 6, 12, 20, 30, … is:", 42, [40, 36, 48])
    add("easy", "If 5x = 45, x equals:", 9, [8, 7, 40])
    add("easy", "20% of 20% of 500 is:", 20, [25, 50, 10])
    add("easy", "The simple interest formula SI = Prt/100 uses t in:", "years (or a year-fraction)", ["months only, never converted", "days always as t=365", "percent of principal as time"])
    add("easy", "A clock shows 3:00. The angle between hands is:", "90°", ["180°", "75°", "60°"])
    add("easy", "How many 2-digit numbers are there?", 90, [89, 99, 100])
    add("easy", "The value of 7! / 5! is:", 42, [35, 49, 12])
    add("easy", "A pair of fair coins: probability of two heads is:", "1/4", ["1/2", "1/3", "3/4"])

    # Medium computed
    add("medium", "A successive +20% then −20% on 100 yields:", 96, [100, 80, 104])
    add("medium", "Marked price ₹800, discount 15%. SP is:", 680, [720, 650, 700])
    add("medium", "A shopkeeper marks 25% above CP of ₹480 and allows 10% discount. SP is:", 540, [520, 560, 500])
    add("medium", "CI on ₹5000 at 10% p.a. compounded annually for 2 years is:", 1050, [1000, 1100, 950])
    add("medium", "Difference CI − SI on ₹4000 at 10% for 2 years is:", 40, [80, 20, 400])
    add("medium", "A can do a job in 12 days, B in 18. Together they finish in:", "7.2 days", ["6 days", "15 days", "9 days"])
    add("medium", "A is thrice B. Together they finish in 12 days. A alone takes:", 16, [18, 15, 36])
    add("medium", "Two trains 120 m and 80 m run at 54 and 36 km/h toward each other. Time to cross is:", "8 s", ["10 s", "6 s", "12 s"])
    add("medium", "A 150 m train at 54 km/h crosses a pole in:", "10 s", ["12 s", "8 s", "15 s"])
    add("medium", "Downstream 20 km/h, upstream 12 km/h. Speed in still water is:", "16 km/h", ["8 km/h", "32 km/h", "15 km/h"])
    add("medium", "The current in the previous speeds (20 down, 12 up) is:", "4 km/h", ["8 km/h", "16 km/h", "6 km/h"])
    add("medium", "Mixture: 40 L of 20% acid + 20 L of 50% acid. Resulting % is:", "30%", ["35%", "25%", "40%"])
    add("medium", "Ages: A is 6 years older than B; sum is 40. A's age is:", 23, [22, 26, 17])
    add("medium", "Partnership: A invests 3 parts, B 2 parts of ₹50000 for a year. A's share of ₹4000 profit is:", 2400, [1600, 2000, 3000])
    add("medium", "nC2 for n=10 is:", 45, [90, 55, 100])
    add("medium", "nP3 for n=8 is:", 336, [56, 512, 24])
    add("medium", "A bag has 4 red and 6 blue balls. P(red) in one draw is:", "2/5", ["4/6", "1/4", "3/5"])
    add("medium", "Work: 8 men finish in 15 days. 10 men would take:", "12 days", ["10 days", "18 days", "7.5 days"])
    add("medium", "A pipe fills in 6 h, another in 8 h. Together they fill in:", "24/7 h", ["7 h", "14 h", "3.5 h"])
    add("medium", "The 10th term of AP 3, 7, 11, … is:", 39, [41, 37, 43])
    add("medium", "Sum of first 20 natural numbers is:", 210, [200, 220, 190])
    add("medium", "If 3x − 7 = 14, x equals:", 7, [6, 21, 5])
    add("medium", "A number is increased by 10% and then by 20%. Net % increase is:", "32%", ["30%", "28%", "22%"])
    add("medium", "Average of 5 numbers is 20. If one number 30 is replaced by 10, new average is:", 16, [18, 15, 14])
    add("medium", "Time from 2:00 to 2:20 for the minute-hour angle formula |30H−5.5M| at 2:20 is:", "50°", ["60°", "55°", "45°"])

    # Difficult computed
    add("difficult", "CI for 2 years at 10% p.a. compounded half-yearly on ₹8000 (4 periods of 5%) is nearest:", 1724, [1600, 1680, 1800])  # 8000*(1.05)^4 - 8000 = 1724.05
    add("difficult", "A sum becomes 27/8 of itself in 3 years at CI. Annual rate is:", "50%", ["25%", "33.3%", "12.5%"])
    add("difficult", "A and B together 10 days; A is twice B. B alone takes:", 30, [20, 15, 25])
    add("difficult", "Three pipes 12, 15, 20 min. All open, time to fill is:", "5 min", ["6 min", "47/4 min", "4 min"])  # 1/12+1/15+1/20 = 5+4+3=12/60=1/5
    add("difficult", "A leak empties in 20 h; a tap fills in 8 h. Net fill time (both open, tank empty) is:", "40/3 h", ["14 h", "12 h", "28 h"])  # 1/8-1/20=5-2=3/40 so 40/3 h
    add("difficult", "Two trains 100 m and 120 m run at 50 km/h and 40 km/h in the same direction. Time to cross is:", "79.2 s", ["8 s", "22 s", "44 s"])
    add("difficult", "A 250 m train at 90 km/h crosses a 350 m platform. Time is:", "24 s", ["20 s", "28 s", "16 s"])  # 90km/h=25 m/s, 600/25=24
    add("difficult", "A man rows 12 km downstream in 2 h and returns in 3 h. Speed of current is:", "1 km/h", ["2 km/h", "2.5 km/h", "5 km/h"])  # down=6, up=4, current=1
    add("difficult", "Milk-water 4:1, 20 L drawn and replaced with water. If this is done once on 50 L, milk left is:", "24 L", ["32 L", "40 L", "30 L"])  # 40*(1-20/50)=24
    add("difficult", "Alligation: mix 30% and 70% to get 45%. Ratio of 30% to 70% is:", "5:3", ["3:5", "2:1", "1:1"])  # (70-45):(45-30)=25:15=5:3
    add("difficult", "P(exactly 2 heads in 3 fair coins) is:", "3/8", ["1/2", "1/8", "3/4"])
    add("difficult", "A committee of 3 from 5 men and 4 women with at least 1 woman: count is:", 74, [84, 60, 70])  # C(9,3)-C(5,3)=84-10=74
    add("difficult", "log10 2 ≈ 0.3010. Then log10 8 is nearest:", "0.9030", ["0.6020", "2.408", "0.3010"])
    add("difficult", "The 20th term of GP 2, 6, 18, … is:", 2 * (3**19), [2 * (3**20), 6 * (3**19), 3**20])
    add("difficult", "Sum of infinite GP 1 + 1/3 + 1/9 + … is:", "3/2", ["3", "2/3", "4/3"])
    add("difficult", "Remainder when 7^5 is divided by 4 (7≡−1 mod 4) is:", 3, [1, 0, 2])  # (-1)^5 = -1 ≡ 3
    add("difficult", "If x + 1/x = 3, then x² + 1/x² equals:", 7, [9, 8, 6])
    add("difficult", "Roots of x² − 5x + 6 = 0 are:", "2 and 3", ["1 and 6", "−2 and −3", "5 and 6"])
    add("difficult", "A clock gains 5 min per hour. In 12 true hours it shows a gain of:", "60 min", ["5 min", "12 min", "55 min"])
    add("difficult", "The number of odd days in a leap year is:", 2, [1, 0, 3])
    add("difficult", "Work: A+B=10 days, B+C=12, C+A=15. A+B+C finish in:", "8 days", ["120/17 days", "9 days", "37/6 days"])
    add("difficult", "SI for 4 years is ₹400 at 5% p.a. Principal is:", 2000, [1600, 2500, 800])
    add("difficult", "A dishonest dealer uses 900 g for 1 kg and claims 10% profit on CP. Actual profit % is:", "22.2%", ["10%", "20%", "11.1%"])  # 1.1 / 0.9 - 1 = 0.222...

    # Fix the two wrong computed items by replacing rather than adding more wrongs.
    # We'll post-filter uniqueness and drop the bad train-cross and A+B+C if present, then add corrected.

    # More unique easy/medium to reach 100 after cleanup
    add("easy", "Convert 0.6 to a percentage.", "60%", ["6%", "0.6%", "600%"])
    add("easy", "The square of 15 is:", 225, [215, 250, 125])
    add("easy", "√196 equals:", 14, [16, 12, 98])
    add("easy", "If 40% of a number is 72, the number is:", 180, [144, 112, 200])
    add("easy", "A rectangle 8 m by 6 m has perimeter:", "28 m", ["48 m", "14 m", "24 m"])
    add("easy", "The area of a triangle with base 10 and height 6 is:", 30, [60, 16, 32])
    add("medium", "A sum doubles in 8 years at SI. Rate is:", "12.5%", ["8%", "16%", "10%"])
    add("medium", "Two numbers' HCF is 12 and LCM is 180. If one number is 36, the other is:", 60, [48, 72, 90])
    add("medium", "A man sells two articles at ₹1980 each, gaining 10% on one and losing 10% on the other. Net result is:", "a loss of 1%", ["no profit no loss", "a gain of 1%", "a loss of 10%"])
    add("medium", "The probability of drawing an ace from a 52-card deck is:", "1/13", ["1/12", "4/13", "1/52"])
    add("difficult", "A cube's surface area is 384 cm². Its volume is:", "512 cm³", ["64 cm³", "256 cm³", "768 cm³"])  # 6a^2=384, a^2=64, a=8, vol=512
    add("difficult", "In how many ways can 5 distinct books be arranged on a shelf?", 120, [25, 60, 24])
    add("difficult", "P(a number > 4) when a fair die is rolled is:", "1/3", ["1/2", "1/6", "2/3"])
    add("difficult", "The harmonic mean of 4 and 6 is:", 4.8, [5, 4, 6])
    add("difficult", "If 2^x = 8^{1/3} × 4, then x equals:", 3, [2, 4, 1])  # 8^{1/3}=2, *4=8=2^3
    add("easy", "What is 25% of 640?", 160, [128, 150, 180])
    add("easy", "A 200 m train at 72 km/h crosses a pole in:", "10 s", ["8 s", "12 s", "20 s"])
    add("easy", "CP = ₹800, SP = ₹920. Profit percent is:", "15%", ["12%", "20%", "10%"])
    add("easy", "The average of 10, 20, 30, 40 and 50 is:", 30, [25, 35, 40])
    add("easy", "LCM of 6 and 15 is:", 30, [15, 45, 90])
    add("easy", "If 8% of a number is 48, the number is:", 600, [384, 480, 560])

    cleaned: list[tuple] = []
    seen_p: set[str] = set()
    for row in rows:
        p = row[1]
        if p in seen_p:
            continue
        seen_p.add(p)
        cleaned.append(row)

    # Extra fillers if short — unique quantitative
    fillers = [
        _pack("easy", "15 × 12 − 40 ÷ 8 equals:", 175, [170, 20, 165]),
        _pack("easy", "The value of (2³)² is:", 64, [32, 16, 12]),
        _pack("easy", "A dozen and a half dozen together make:", 18, [12, 24, 6]),
        _pack("easy", "If 1/2 + 1/3 = x, then x is:", "5/6", ["2/5", "1/6", "1/5"]),
        _pack("easy", "The median of 3, 9, 7, 5, 11 is:", 7, [9, 5, 8]),
        _pack("medium", "A can finish 5/8 of a work in 10 days. Whole work takes:", 16, [8, 18, 12]),
        _pack("medium", "The compound ratio of 2:3 and 4:5 is:", "8:15", ["6:8", "8:5", "2:5"]),
        _pack("medium", "If 15 workers take 12 days, 10 workers take:", 18, [8, 20, 16]),
        _pack("medium", "A sum of ₹P at 12% SI gives ₹360 as interest in 2 years. P is:", 1500, [1800, 1200, 3000]),
        _pack("medium", "The 4th proportional to 3, 4, 9 is:", 12, [16, 6, 13]),
        _pack("difficult", "A mixture of 40 L is 10% spirit. How much spirit to add to make it 20%?", "5 L", ["4 L", "8 L", "10 L"]),  # 4/(40+x)=0.2 -> 4=8+0.2x -> x= - wait 10% of 40=4. 4/(40+x)=0.2 => 4=8+0.2x => x=-20 impossible
        # 4+x over 40+x = 0.2 => 4+x = 8+0.2x => 0.8x=4 => x=5. Yes 4+x not 4. Correct.
        _pack("difficult", "Find x if 5^{x+1} = 25^{x−1}.", 3, [2, 1, 4]),  # 5^{x+1}=5^{2x-2} => x+1=2x-2 => x=3
        _pack("difficult", "The number of trailing zeros in 100! is:", 24, [20, 25, 22]),
        _pack("difficult", "A wheel of radius 35 cm rolls 22 m. Number of revolutions is (π=22/7):", 10, [20, 5, 14]),  # C=2πr=220 cm=2.2 m, 22/2.2=10
        _pack("difficult", "If mean of 5 observations is 20 and one 30 is excluded, mean of remaining is:", 17.5, [15, 18, 16]),
    ]
    for row in fillers:
        if row[1] in seen_p:
            continue
        seen_p.add(row[1])
        cleaned.append(row)

    by = {k: [] for k in DIFFS}
    for row in cleaned:
        by[row[0]].append(row)
    targets = {"easy": 40, "medium": 30, "difficult": 30}
    out: list[tuple] = []
    leftover: list[tuple] = []
    for k in DIFFS:
        bucket = by[k]
        out.extend(bucket[: targets[k]])
        leftover.extend(bucket[targets[k] :])
    if len(out) < TARGET:
        out.extend(leftover[: TARGET - len(out)])
    if len(out) < TARGET:
        raise SystemExit(
            f"aptitude short: {len(out)} by={[ (k, len(by[k])) for k in DIFFS ]}"
        )
    out = out[:TARGET]
    for k in DIFFS:
        n = sum(1 for r in out if r[0] == k)
        if n < 5:
            raise SystemExit(f"aptitude {k} only {n}")
    remap = {"easy": "medium", "medium": "hard", "difficult": "expert"}
    remapped = [(remap.get(row[0], row[0]), *row[1:]) for row in out]
    mix = {k: sum(1 for r in remapped if r[0] == k) for k in ("medium", "hard", "expert")}
    if mix != {"medium": 40, "hard": 30, "expert": 30} or len(remapped) != TARGET:
        raise SystemExit(f"aptitude mix {mix} len {len(remapped)}")
    return remapped


def emit_php(banks: dict[str, list]) -> str:
    lines = [
        "<?php",
        "/**",
        " * Syncpedia Basics question banks (generated).",
        " * 100 quantitative aptitude + 100 per domain. Attempt paper is 10 aptitude + 20 domain in 20 minutes.",
        " * Do not edit by hand — regenerate via _emit_basics_banks.py",
        " */",
        "function syncpediaBasicsBankDefs(): array",
        "{",
        "    $qs = [];",
    ]
    order = ["aptitude"] + DOMAINS
    for domain in order:
        lines.append(f"    // —— {domain} ({len(banks[domain])}) ——")
        for diff, prompt, a, b, c, d, ans in banks[domain]:
            lines.append(
                "    $qs[] = syncpediaBasicsMcq("
                f"'{domain}', '{diff}', '{php_escape(prompt)}', "
                f"'{php_escape(a)}', '{php_escape(b)}', '{php_escape(c)}', '{php_escape(d)}', '{ans}');"
            )
        lines.append("")
    lines.append("    return $qs;")
    lines.append("}")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    existing = parse_existing()
    banks: dict[str, list] = {}
    apt = aptitude_bank()
    if len(apt) != TARGET:
        raise SystemExit(f"aptitude {len(apt)}")
    banks["aptitude"] = apt
    print("aptitude", len(apt), {k: sum(1 for r in apt if r[0] == k) for k in ("medium", "hard", "expert")})
    for d in DOMAINS:
        rows = list(existing.get(d, []))
        if len(rows) < 90:
            extra_fn = EXTRAS.get(d) or NEW_DOMAIN_EXTRAS.get(d)
            pad_fn = PADS.get(d)
            if extra_fn:
                rows.extend(extra_fn())
            if pad_fn:
                rows.extend(pad_fn())
        merged = fit_domain(rows, d)
        banks[d] = merged
        print(d, len(merged), {k: sum(1 for r in merged if r[0] == k) for k in DOMAIN_TARGETS})
    OUT.write_text(emit_php(banks), encoding="utf-8", newline="\n")
    print("wrote", OUT, "bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
