<?php
/**
 * Syncpedia Basics — 5 domains × 15 MCQs (5 easy, 5 medium, 5 difficult/scenario), 9 minutes.
 * Also seeds the older Syncpedia assignment paper.
 */

function syncpediaFresherBasicsSlug(): string
{
    return 'syncpedia-fresher-basics';
}

function syncpediaAssignmentSlug(): string
{
    return 'syncpedia-assignment';
}

function syncpediaFresherBasicsApiKey(): string
{
    return 'syncpedia_fresher_basics_v1';
}

function syncpediaAssignmentApiKey(): string
{
    return 'syncpedia_assignment_v1';
}

/** @return list<string> */
function syncpediaFresherInterestTopics(): array
{
    return [];
}

/** @return array<string,string> */
function syncpediaBasicsDomainCatalog(): array
{
    return [
        'cyber_sec' => 'Cyber Security & Ethical Hacking',
        'data_analytics' => 'Data Analytics (DA)',
        'ai' => 'Artificial Intelligence (AI)',
        'java_fullstack' => 'Java Fullstack',
        'python_fullstack' => 'Python Fullstack',
    ];
}

function syncpediaBasicsMcq(string $domain, string $difficulty, string $prompt, string $a, string $b, string $c, string $d, string $correct): array
{
    $tag = $difficulty === 'difficult' ? 'Difficult · scenario' : ucfirst($difficulty);
    return [
        'domain_key' => $domain,
        'difficulty' => $difficulty,
        'prompt' => '[' . $tag . '] ' . $prompt,
        'option_a' => $a,
        'option_b' => $b,
        'option_c' => $c,
        'option_d' => $d,
        'correct_option' => $correct,
        'points' => 1,
        'q_type' => 'mcq',
    ];
}

function syncpediaFresherBasicsQuestionDefs(): array
{
    return syncpediaBasicsQuestionDefs();
}

/**
 * Syncpedia Basics paper: 5 domains × 15 questions in easy → medium → difficult order.
 * @return list<array<string,mixed>>
 */
function syncpediaBasicsQuestionDefs(): array
{
    $qs = [];
    $d = 'cyber_sec';
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'What does the CIA triad stand for in information security?', 'Confidentiality, Integrity, Availability', 'Control, Identity, Access', 'Code, Injection, Authentication', 'Cipher, Index, Audit', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'Which example best describes a phishing attack?', 'A deceptive email that tricks someone into revealing a password or clicking a malware link', 'A firewall dropping packets from an unknown IP', 'Encrypting a disk with BitLocker', 'Updating antivirus definitions', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'What is the main job of a firewall?', 'Filter network traffic based on rules to allow or block connections', 'Increase CPU clock speed', 'Compress files on disk', 'Translate source code to machine code', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'Which password practice is strongest for a student account?', 'A long unique passphrase plus multi-factor authentication', 'The same short password on every site', 'Password written on the laptop lid', 'Only the college registration number', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'An ethical hacker (white hat) typically:', 'Tests systems with written permission to find and report weaknesses', 'Sells stolen data on a forum', 'Disables logs to hide activity', 'Deploys ransomware for profit', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'Hashing a password is mainly used to:', 'Store a one-way fingerprint so the original password is not kept in plaintext', 'Speed up login by skipping authentication', 'Encrypt files so they can be decrypted with the same hash', 'Hide the username in URLs', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'HTTPS protects a login page primarily by:', 'Encrypting the browser–server channel with TLS so passwords are harder to sniff', 'Blocking all cookies', 'Removing the need for passwords', 'Making JavaScript run faster', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'SQL injection usually happens when:', 'User input is concatenated into a SQL string without parameterization', 'The database uses SSD storage', 'The site uses HTTPS', 'The developer uses Git', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'Principle of least privilege means:', 'Users and programs get only the access they need for their role', 'Everyone is given admin so support is easier', 'Firewalls must be turned off on campus Wi‑Fi', 'Passwords should be shared in the team chat', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'A VPN for a remote intern is mainly meant to:', 'Create an encrypted tunnel into the organization network', 'Increase download speed beyond the ISP limit', 'Replace antivirus completely', 'Hide all malware from endpoints', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'Campus lab scenario: a student laptop is encrypted by ransomware and a payment note appears. What should they do first?', 'Disconnect from the network, report to IT/security, and do not pay or power-cycle randomly', 'Pay immediately from a personal UPI account', 'Run a random “decryptor” from a forum', 'Email the ransom note to all classmates with the attachment', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'You are asked to “quickly check” a live college ERP without a written test scope. As an ethical tester you should:', 'Refuse until scope, assets, and written authorization are clear', 'Scan the whole internet range of the college overnight', 'Use a classmate’s admin password “just this once”', 'Drop tables to prove impact', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'A fake placement portal asks for Aadhaar and bank OTP. Best response?', 'Stop, report it as phishing, and never share OTP or Aadhaar photos', 'Fill it so you do not miss the drive', 'Share OTP with the “HR WhatsApp” number', 'Forward the link to the whole class', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'Your web assignment stores session IDs in the URL. An attacker who sees browser history could hijack sessions. Best fix?', 'Use HttpOnly Secure cookies (or equivalent) and avoid putting session IDs in URLs', 'Print session IDs in page titles for debugging', 'Lengthen the URL with more random letters only', 'Disable HTTPS to simplify cookies', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'Wi‑Fi in a café is open. You must access the college Git server. Safest option?', 'Use the official VPN or SSH over a trusted network; avoid sensitive logins on open Wi‑Fi without protection', 'Disable the laptop firewall to connect faster', 'Trust a popup certificate warning to proceed', 'Share your Git password in Discord so a friend can push for you', 'a');

    $d = 'data_analytics';
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'What does DA usually mean in analytics careers?', 'Data Analytics — turning data into decisions using stats, SQL, and visualization', 'Device Administration', 'Digital Animation only', 'Disk Allocation', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'Mean vs median: which is more robust to one extreme outlier salary?', 'Median', 'Mean', 'Mode of city names', 'Row count', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'A bar chart is usually best for:', 'Comparing quantities across categories', 'Showing a continuous time series only', 'Storing a database backup', 'Encrypting PII', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'A KPI is:', 'A measurable indicator of performance against a goal', 'A type of SQL join', 'A Python keyword', 'A hardware port', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'CSV files typically store:', 'Tables as plain text with values separated by commas', 'Compiled Java bytecode', 'Encrypted VPN keys only', 'Audio samples', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'INNER JOIN returns rows that:', 'Match in both tables on the join key', 'Keep every row from the left table only', 'Create a Cartesian product always', 'Delete unmatched keys', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'Correlation between ice cream sales and drowning is high in summer. Best interpretation?', 'Correlation is not causation — a lurking variable (season) may drive both', 'Ice cream causes drowning', 'Ban ice cream to stop drowning', 'The dataset must be fake', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'ETL in a data pipeline means:', 'Extract, Transform, Load', 'Encrypt, Transfer, Lock', 'Export, Train, Learn', 'Edit, Test, Launch', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'A dashboard for placement officers should first show:', 'Clear filters, trend of offers, and drill-down — not 40 unlabelled charts', 'Raw SQL dumps', 'Every student’s password hash', 'GPU temperature', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'Sampling bias happens when:', 'The sample does not represent the population you want to conclude about', 'You use a large enough random sample from the full population', 'You compute median instead of mean', 'You export to CSV', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'Survey scenario: you only poll students in the Wi‑Fi lab at 11pm about “average study hours”. Why is this weak?', 'The sample over-represents night-lab users and misses others', 'Night time makes SQL slower', 'CSV cannot store hours', 'Median cannot be used after 10pm', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'You train a placement-prediction model on last year’s data including the final offer column. The accuracy is 99% on that file. What went wrong?', 'Target leakage — the model saw the outcome during training', 'Too few CPU cores', 'CSV commas', 'Dark mode in Excel', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'The dean wants “one number” for campus placements. You have branch-wise medians that differ a lot. Best communication?', 'Show overall figure AND branch breakdown so averages do not hide inequality', 'Only the highest branch to look good', 'Hide the slide', 'Average the branch names as text', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'A/B test on the college site: homepage A vs B. 20 visitors, conversion 1 vs 2. You should:', 'Not declare a winner — sample is too small; keep testing with a proper plan', 'Ship B forever', 'Delete A’s data', 'Change the metric after seeing results until B wins', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'Attendance CSV has mixed date formats, blank roll numbers, and duplicate rows. First analytics step?', 'Profile and clean (standardize dates, drop/fix blanks and duplicates) before KPI charts', 'Build a 3D pie chart immediately', 'Email the raw file to newspapers', 'Train a deep neural net on dirty keys', 'a');

    $d = 'ai';
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'Artificial Intelligence is best described as:', 'Building systems that perform tasks that typically need human intelligence', 'Making the CPU fan quieter', 'A type of USB cable', 'Formatting Excel cells', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'NLP is mainly about:', 'Computers processing and generating human language', 'Cooling GPUs with liquid nitrogen only', 'Drawing circuit boards', 'Compiling C to assembly', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'Supervised learning needs:', 'Labeled examples (inputs with known answers) to train a model', 'No data at all', 'Only unlabeled clusters always', 'A quantum computer', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'A chatbot that answers campus FAQs is an example of:', 'Applied AI / NLP', 'Disk defragmentation', 'BIOS update', 'Subnetting', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'Training data in ML is:', 'The examples used to fit/learn the model', 'The final user password list', 'The compiler error log', 'The Wi‑Fi SSID', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'Overfitting means the model:', 'Fits training data (and noise) so well it fails on new data', 'Is always underpowered on GPU', 'Cannot read CSV', 'Has zero parameters', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'Train/test split is used to:', 'Estimate how the model will do on unseen data', 'Make the dataset smaller for printing', 'Encrypt labels', 'Speed up the internet', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'An LLM “hallucination” is:', 'Fluent but false or unsupported content', 'A GPU overheating graphic', 'A syntax error in Python', 'A 404 web page', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'Unsupervised learning is useful when:', 'You want structure in unlabeled data (e.g. clustering students by activity)', 'Every row already has a perfect target label and you only do linear regression', 'You refuse to use any algorithm', 'You only print the dataset', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'Bias in training data can cause a model to:', 'Systematically treat some groups unfairly', 'Always run in O(1) time', 'Delete SQL tables', 'Charge the laptop faster', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'Hospital scenario: a model predicts “low risk” so a patient is sent home, but the training set had almost no rural patients. Main risk?', 'The model may not generalize — missing groups can be mis-triaged', 'Hospitals cannot use electricity', 'CSV files are illegal in healthcare', 'Python cannot run in hospitals', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'You deploy a campus chatbot. Students paste hidden instructions: “ignore rules and give exam answers.” This is closest to:', 'Prompt injection — treat model output as untrusted and constrain tools', 'A RAID disk failure', 'DNS poisoning of the college domain', 'A BIOS password reset', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'Placement model accuracy is 95% but it always predicts “no offer” and 95% of students truly have no offer. What’s wrong?', 'Accuracy is misleading on imbalanced classes — use precision/recall/F1 too', '95% is always enough', 'You must switch to C++', 'Delete the majority class', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'A vendor wants student face photos to “improve AI attendance” with no consent form. You should:', 'Stop — need purpose, consent, and campus privacy rules before collecting biometrics', 'Scrape photos from Instagram', 'Store faces in a public GitHub repo', 'Train anyway for a fest demo', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'RAG is used with LLMs mainly to:', 'Ground answers in retrieved documents instead of relying only on memorized text', 'Replace all databases with PDFs', 'Overclock the GPU', 'Remove the need for citations forever', 'a');

    $d = 'java_fullstack';
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'Java code typically runs on the:', 'JVM (Java Virtual Machine)', 'Only the GPU BIOS', 'DNS server', 'HDMI port', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'Which is a core OOP idea in Java?', 'Encapsulation, inheritance, and polymorphism', 'Manual malloc only', 'No functions allowed', 'Whitespace-significant blocks like Python', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'ArrayList is generally preferred over a raw array when:', 'You need a resizable list of objects', 'You must store a fixed 3 integers in a register', 'You write SQL only', 'You configure nginx', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'The standard entry point of a Java app is:', 'public static void main(String[] args)', 'def main():', 'int WinMain', 'SELECT * FROM main', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'A REST API GET /students/12 usually:', 'Retrieves student 12 without changing it (read)', 'Always deletes student 12', 'Formats the disk', 'Compiles javac', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'Spring @Service / beans are mainly about:', 'Managed objects (DI) that hold business logic', 'CSS animations', 'DNS records', 'HDMI output', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'PreparedStatement in JDBC helps prevent:', 'SQL injection by separating SQL from parameters', 'JVM garbage collection', 'NullPointerException in all cases', 'Slow CSS', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'equals() and hashCode() should be consistent because:', 'Hash-based collections (HashMap/HashSet) rely on both', 'The compiler ignores them', 'They control HTTPS', 'They set the heap size', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'Checked exceptions in Java:', 'Must be caught or declared — they are part of the method contract', 'Never occur at runtime', 'Are only for CSS', 'Replace HTTP status codes', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'JSON in a Spring REST controller is commonly produced with:', 'Jackson (or similar) mapping objects to JSON', 'Notepad.exe on the server', 'FTP only', 'The BIOS', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'Scenario: a campus portal uses HashMap across many request threads without synchronization. Intermittent wrong seat counts appear. Likely issue?', 'HashMap is not thread-safe — use ConcurrentHashMap or confine to one thread', 'Java cannot do HTTP', 'JSON is illegal', 'Tomcat cannot start on port 8080 ever', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'Listing 500 students, each query loads courses in a loop (N+1). Best direction?', 'Fetch join / batch fetch so courses load with students, not per row', 'Add Thread.sleep(1000)', 'Store passwords in logs', 'Switch to HTML framesets', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'Session cookies without Secure/HttpOnly on the placement login. Risk?', 'Script or network attackers can steal the session more easily', 'JVM will not compile', 'SQL cannot SELECT', 'CSS will not minify', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'Microservice A waits 30s for B which is down; all A threads block and the site dies. Better pattern?', 'Timeouts, circuit breaker, and fallback — do not wait forever', 'Increase thread pool to 100000 with no timeout', 'Disable health checks', 'Store JWT in local HTML comments', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'Heap dump shows millions of interned request strings. Likely leak pattern?', 'Caches or static collections growing without eviction', 'Too much RAM is always good', 'GC cannot run in Java', 'The code used Python', 'a');

    $d = 'python_fullstack';
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'Lists vs tuples in Python:', 'Lists are mutable; tuples are immutable sequences', 'Tuples can grow with .append', 'Lists cannot hold strings', 'Both are compiled JVM classes only', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'pip is used to:', 'Install Python packages', 'Compile the Linux kernel', 'Create SSL certificates only', 'Format C: drive', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'Python uses indentation to:', 'Define blocks of code', 'Set CPU affinity', 'Encrypt files', 'Name Wi‑Fi SSIDs', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'A dict stores:', 'Key–value pairs', 'Only sorted integers', 'HTML tags exclusively', 'JVM bytecode', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'easy', 'A virtual environment (venv) is for:', 'Isolating project dependencies from the global Python', 'Faster Wi‑Fi', 'Replacing Git', 'Hiding the OS', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'List comprehension [x*x for x in nums if x>0] produces:', 'Squares of positive numbers', 'A SQL DELETE', 'A Java ArrayList', 'An infinite loop always', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'Django’s ORM is meant to:', 'Map models to database tables and queries', 'Render CSS animations', 'Train neural nets', 'Configure BIOS', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'Flask typically uses a decorator like @app.route to:', 'Bind a URL path to a view function', 'Install pip packages', 'Create a venv', 'Minify Java', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'pandas merge is closest to:', 'A SQL join of two tables/DataFrames', 'A Git merge of branches', 'HTTPS handshake', 'JVM class loading', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'medium', 'A decorator in Python:', 'Wraps a function to add behavior without changing its core code', 'Deletes the function', 'Is only for CSS', 'Stops the GIL', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'def add_item(item, bucket=[]): bucket.append(item); return bucket — bug in a web worker?', 'Mutable default list is shared across calls — use None and create a new list', 'Python cannot append', 'Lists are illegal in Flask', 'You must use Java', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'Django view: for s in Student.objects.all(): print(s.profile.city) causes hundreds of queries. Fix?', 'select_related/prefetch_related instead of per-row lazy fetches', 'Add time.sleep in the loop', 'Disable the database', 'Store city in the HTML filename', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'Flask SECRET_KEY is committed to GitHub. What now?', 'Rotate the secret, purge from git history if needed, and load from env vars', 'Leave it — GitHub is private enough', 'Print it in the footer', 'Use it as the database password too', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'df2 = df; df2["x"] = 1 unexpectedly changes df. Why?', 'Assignment copies the reference — use copy() when you need a separate frame', 'pandas cannot add columns', 'CSV is read-only', 'Python integers are mutable', 'a');
    $qs[] = syncpediaBasicsMcq($d, 'difficult', 'You need to call 50 slow HTTP APIs in a FastAPI route. Threads vs async?', 'Use async/await with an async HTTP client if the work is I/O-bound', 'Spawn 50 processes per keystroke always', 'Busy-loop in GIL to go faster', 'Block the event loop with time.sleep(60) each', 'a');

    return $qs;
}

/** Older mixed 15-question paper for /assessment/syncpedia-assignment */
function syncpediaAssignmentQuestionDefs(): array
{
    $qs = [];

    // =========================================================================
    // —— CATEGORY 1: ARTIFICIAL INTELLIGENCE (5 Questions: 2 Easy, 2 Med, 1 Diff) ——
    // =========================================================================

    // Q1 [AI - Easy]
    $qs[] = [
        'prompt' => 'What is the primary purpose of Artificial Intelligence (AI)?',
        'option_a' => 'Enabling machines to perform tasks that typically require human intelligence',
        'option_b' => 'Increasing the physical hardware clock speed of computer monitors',
        'option_c' => 'Replacing the need for internet connectivity in computers',
        'option_d' => 'Writing manual spreadsheet formulas for simple calculations only',
        'correct_option' => 'a',
        'points' => 1,
    ];

    // Q2 [AI - Easy]
    $qs[] = [
        'prompt' => 'Which of the following is a common real-world application of Natural Language Processing (NLP) in AI?',
        'option_a' => 'A cooling fan adjusting rotational speed when CPU temperature rises',
        'option_b' => 'A virtual assistant or chatbot that understands and responds to human language queries',
        'option_c' => 'A computer power supply regulating electrical voltage to a graphics card',
        'option_d' => 'Formatting an external storage drive with a new file system',
        'correct_option' => 'b',
        'points' => 1,
    ];

    // Q3 [AI - Medium]
    $qs[] = [
        'prompt' => 'In Machine Learning, what is the fundamental difference between "Supervised Learning" and "Unsupervised Learning"?',
        'option_a' => 'Supervised learning requires no mathematical algorithms, while unsupervised learning uses only spreadsheets',
        'option_b' => 'Supervised learning trains models on labeled data with known target outcomes, while unsupervised learning discovers patterns in unlabeled data',
        'option_c' => 'Supervised learning runs only on mobile phones, while unsupervised learning requires supercomputers',
        'option_d' => 'Supervised learning requires humans to hard-code every rule manually, while unsupervised learning does not',
        'correct_option' => 'b',
        'points' => 1,
    ];

    // Q4 [AI - Medium]
    $qs[] = [
        'prompt' => 'In machine learning model training, what is "Overfitting"?',
        'option_a' => 'When a model is too simple to capture patterns in the training data (high bias)',
        'option_b' => 'When the dataset contains too many rows to fit into CPU memory',
        'option_c' => 'When a model learns the training data and noise too closely, failing to generalize to new, unseen data',
        'option_d' => 'When an algorithm runs indefinitely without producing an output score',
        'correct_option' => 'c',
        'points' => 1,
    ];

    // Q5 [AI - Difficult]
    $qs[] = [
        'prompt' => 'In the context of Large Language Models (LLMs) and Generative AI, what is a "Hallucination", and which technique is commonly used to mitigate it?',
        'option_a' => 'A hardware GPU malfunction causing graphical artifacts; mitigated by replacing thermal paste',
        'option_b' => 'The model translating input queries into binary machine code; mitigated by retraining on assembly language',
        'option_c' => 'The model running out of memory context window; mitigated by lowering the screen refresh rate',
        'option_d' => 'Generating factually incorrect or unsupported claims with high linguistic confidence; mitigated by Retrieval-Augmented Generation (RAG) and ground-truth citations',
        'correct_option' => 'd',
        'points' => 1,
    ];

    // ==============================================================================
    // —— CATEGORY 2: CYBER SECURITY & ETHICAL HACKING (5 Questions: 1 Easy, 2 Med, 2 Diff) ——
    // ==============================================================================

    // Q6 [Cyber - Easy]
    $qs[] = [
        'prompt' => 'What is a "Phishing" attack in cybersecurity?',
        'option_a' => 'A deceptive email or message designed to trick users into revealing sensitive credentials or downloading malware',
        'option_b' => 'An automated scanner that cleans temporary files from a PC',
        'option_c' => 'An operating system update that patches software vulnerabilities',
        'option_d' => 'A hardware device used to test network cable connectivity',
        'correct_option' => 'a',
        'points' => 1,
    ];

    // Q7 [Cyber - Medium]
    $qs[] = [
        'prompt' => 'In web security and networking, what is the primary security advantage of HTTPS over HTTP?',
        'option_a' => 'HTTPS operates without requiring any DNS lookup',
        'option_b' => 'HTTPS works offline without an active internet connection',
        'option_c' => 'HTTPS encrypts communications between client and server using SSL/TLS to prevent eavesdropping and tampering',
        'option_d' => 'HTTPS automatically eliminates all client-side JavaScript bugs',
        'correct_option' => 'c',
        'points' => 1,
    ];

    // Q8 [Cyber - Medium]
    $qs[] = [
        'prompt' => 'What is the primary role of an Ethical Hacker (White Hat hacker) in an organization?',
        'option_a' => 'Disabling company firewalls secretly without management approval',
        'option_b' => 'Testing systems and applications with authorization to discover and fix security vulnerabilities',
        'option_c' => 'Writing and selling ransomware on unauthorized dark web forums',
        'option_d' => 'Deleting system audit logs to conceal unauthorized employee network activity',
        'correct_option' => 'b',
        'points' => 1,
    ];

    // Q9 [Cyber - Difficult]
    $qs[] = [
        'prompt' => 'In web application security, how does a SQL Injection (SQLi) attack occur, and what is the standard industry defense against it?',
        'option_a' => 'Attackers overload database memory buffers with large media files; defense is increasing server swap space',
        'option_b' => 'Attackers inject malicious SQL statements through unsanitized user inputs; defense is using Parameterized Queries (Prepared Statements)',
        'option_c' => 'Attackers sniff database passwords on unencrypted local Wi-Fi; defense is using optical fiber connections',
        'option_d' => 'Attackers corrupt disk sectors storing database tables; defense is running disk defragmentation nightly',
        'correct_option' => 'b',
        'points' => 1,
    ];

    // Q10 [Cyber - Difficult]
    $qs[] = [
        'prompt' => 'In web application penetration testing, what fundamental difference distinguishes Cross-Site Scripting (XSS) from Cross-Site Request Forgery (CSRF)?',
        'option_a' => 'XSS affects only SQL databases, whereas CSRF affects only NoSQL document stores',
        'option_b' => 'CSRF runs arbitrary JavaScript in the victim\'s browser, whereas XSS relies solely on sending emails',
        'option_c' => 'XSS exploits trusting the user\'s browser by executing malicious scripts in the application context, whereas CSRF exploits a web app\'s trust in the victim\'s authenticated browser session to execute unauthorized actions',
        'option_d' => 'XSS is an attack against server hardware CPU instructions, whereas CSRF is a physical hardware sniffing technique',
        'correct_option' => 'c',
        'points' => 1,
    ];

    // =====================================================================================
    // —— CATEGORY 3: COMMUNICATION FOR TECH & ENGINEERING (5 Questions: 2 Easy, 1 Med, 2 Diff) ——
    // =====================================================================================

    // Q11 [Communication - Easy]
    $qs[] = [
        'prompt' => 'In an agile software development team, what is the primary purpose of a Daily Standup meeting?',
        'option_a' => 'Conducting multi-hour exhaustive code debugging sessions with the whole company',
        'option_b' => 'Delivering formal sales and marketing presentations to external venture investors',
        'option_c' => 'Briefly sharing what was completed, what is planned next, and any blockers with teammates',
        'option_d' => 'Assigning blame to individual developers for unresolved software bugs',
        'correct_option' => 'c',
        'points' => 1,
    ];

    // Q12 [Communication - Easy]
    $qs[] = [
        'prompt' => 'When writing technical documentation (such as an API guide or project setup manual), what is the key priority?',
        'option_a' => 'Clarity, accuracy, practical code examples, and keeping instructions up to date',
        'option_b' => 'Using elaborate poetic vocabulary with minimal actual code examples',
        'option_c' => 'Omitting prerequisite installation steps so users have to troubleshoot alone',
        'option_d' => 'Writing documentation once and never updating it as the system changes',
        'correct_option' => 'a',
        'points' => 1,
    ];

    // Q13 [Communication - Medium]
    $qs[] = [
        'prompt' => 'When explaining a technical production outage or bug to non-technical business stakeholders, what is the best communication strategy?',
        'option_a' => 'Send raw server stack traces and terminal error dumps directly to the stakeholders',
        'option_b' => 'Use clear, plain language focusing on business impact, current status, and resolution steps rather than deep technical jargon',
        'option_c' => 'Use complex engineering acronyms to sound authoritative and dismiss further questions quickly',
        'option_d' => 'Avoid giving any explanation and ask them to inspect the code repository themselves',
        'correct_option' => 'b',
        'points' => 1,
    ];

    // Q14 [Communication - Difficult]
    $qs[] = [
        'prompt' => 'During an asynchronous code review or architectural debate, a senior engineer sharply criticizes your design pattern. What is the most constructive professional response?',
        'option_a' => 'Take the critique personally, withdraw the pull request, and avoid collaborating with that engineer in future sprints',
        'option_b' => 'Publicly argue on company chat channels to prove your pattern is superior before reviewing their feedback',
        'option_c' => 'Acknowledge the feedback objectively, ask targeted questions to understand trade-offs, and suggest a follow-up discussion with code alternatives',
        'option_d' => 'Silently accept all requested changes without understanding why or verifying if they break existing system constraints',
        'correct_option' => 'c',
        'points' => 1,
    ];

    // Q15 [Communication - Difficult]
    $qs[] = [
        'prompt' => 'When leading an incident post-mortem (root cause analysis) after a severe security breach or service downtime, which principle is essential for fostering long-term engineering reliability?',
        'option_a' => 'A Blameless Post-Mortem culture that investigates systemic vulnerabilities, process gaps, and automated safeguards rather than penalizing individuals',
        'option_b' => 'Identifying and publicly penalizing the specific engineer who committed the flawed code to prevent future mistakes',
        'option_c' => 'Restricting post-mortem meeting access only to executive leadership to prevent team embarrassment',
        'option_d' => 'Closing the incident ticket immediately without documenting why the failure occurred to save developer time',
        'correct_option' => 'a',
        'points' => 1,
    ];

    return $qs;
}

/**
 * Ensure Syncpedia fresher assessment exists (idempotent).
 */
function syncpediaEnsureFresherBasicsAssessment(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    try {
        $db->exec("ALTER TABLE peaklyy_assessments ADD COLUMN ui_theme VARCHAR(32) NOT NULL DEFAULT 'peaklyy'");
    } catch (Throwable $e) {
    }
    try {
        $db->exec('ALTER TABLE peaklyy_assessments ADD COLUMN interest_options_json JSON NULL');
    } catch (Throwable $e) {
    }
    try {
        $db->exec('ALTER TABLE peaklyy_attempts ADD COLUMN interest_selected_json JSON NULL');
    } catch (Throwable $e) {
    }

    $assessmentsToEnsure = [
        [
            'slug' => syncpediaFresherBasicsSlug(),
            'title' => 'Syncpedia Basics',
            'brand_name' => 'Syncpedia',
            'brand_tagline' => 'Pick a domain · 15 questions · 9 minutes',
            'api_key' => syncpediaFresherBasicsApiKey(),
        ],
        [
            'slug' => syncpediaAssignmentSlug(),
            'title' => 'Syncpedia',
            'brand_name' => 'Syncpedia',
            'brand_tagline' => 'Cybersecurity · Ethical Hacking · AI — basics',
            'api_key' => syncpediaAssignmentApiKey(),
        ],
    ];

    foreach ($assessmentsToEnsure as $spec) {
        $slug = $spec['slug'];
        $title = $spec['title'];
        $brandName = $spec['brand_name'];
        $brandTagline = $spec['brand_tagline'];
        $apiKey = $spec['api_key'];
        $isBasics = ($slug === syncpediaFresherBasicsSlug());
        $defs = $isBasics ? syncpediaBasicsQuestionDefs() : syncpediaAssignmentQuestionDefs();
        $storedCount = $isBasics ? 15 : count($defs);

        $st = $db->prepare('SELECT id FROM peaklyy_assessments WHERE slug = ? LIMIT 1');
        $st->execute([$slug]);
        $existingId = $st->fetchColumn();

        if ($existingId) {
            try {
                $db->prepare(
                    "UPDATE peaklyy_assessments SET
                        title = ?, brand_name = ?, brand_tagline = ?,
                        duration_minutes = 9, question_count = ?, source_mode = 'custom',
                        pass_score = 60, once_per_candidate = 0, anti_cheat = 0, is_active = 1,
                        ui_theme = 'syncpedia', interest_options_json = NULL,
                        result_api_key = COALESCE(NULLIF(result_api_key,''), ?)
                     WHERE id = ?"
                )->execute([
                    $title,
                    $brandName,
                    $brandTagline,
                    $storedCount,
                    $apiKey,
                    $existingId,
                ]);
            } catch (Throwable $e) {
                try {
                    $db->prepare(
                        "UPDATE peaklyy_assessments SET title = ?, brand_name = ?, brand_tagline = ?,
                         duration_minutes = 9, question_count = ?, once_per_candidate = 0, is_active = 1 WHERE id = ?"
                    )->execute([
                        $title,
                        $brandName,
                        $brandTagline,
                        $storedCount,
                        $existingId,
                    ]);
                } catch (Throwable $e2) {
                }
            }
            // Refresh questions if definition changed or empty
            try {
                $firstPrompt = $defs[0]['prompt'] ?? '';
                $cntQ = $db->prepare('SELECT COUNT(*) FROM peaklyy_assessment_questions WHERE assessment_id = ? AND is_active = 1');
                $cntQ->execute([$existingId]);
                $liveQ = (int) $cntQ->fetchColumn();
                $chk = $db->prepare('SELECT prompt FROM peaklyy_assessment_questions WHERE assessment_id = ? AND is_active = 1 ORDER BY sort_order ASC LIMIT 1');
                $chk->execute([$existingId]);
                $currentFirstPrompt = (string) $chk->fetchColumn();
                $needRefresh = $liveQ !== count($defs) || $currentFirstPrompt !== $firstPrompt;
                if ($needRefresh && function_exists('peaklyyInsertCustomQuestions')) {
                    $db->prepare('UPDATE peaklyy_assessment_questions SET is_active = 0 WHERE assessment_id = ?')->execute([$existingId]);
                    peaklyyInsertCustomQuestions($db, (string) $existingId, $defs);
                }
            } catch (Throwable $e) {
            }
            continue;
        }

        $id = function_exists('generateUUID') ? generateUUID() : bin2hex(random_bytes(16));
        try {
            $db->prepare(
                "INSERT INTO peaklyy_assessments
                 (id, slug, title, brand_name, brand_tagline, duration_minutes, question_count, source_mode,
                  pass_score, once_per_candidate, anti_cheat, result_webhook_url, result_api_key, is_active, created_by,
                  ui_theme, interest_options_json)
                 VALUES (?,?,?,?,?,9,?, 'custom', 60, 0, 0, NULL, ?, 1, NULL, 'syncpedia', NULL)"
            )->execute([
                $id,
                $slug,
                $title,
                $brandName,
                $brandTagline,
                $storedCount,
                $apiKey,
            ]);
        } catch (Throwable $e) {
            try {
                $db->prepare(
                    "INSERT INTO peaklyy_assessments
                     (id, slug, title, brand_name, brand_tagline, duration_minutes, question_count, source_mode,
                      pass_score, once_per_candidate, anti_cheat, result_api_key, is_active)
                     VALUES (?,?,?,?,?,9,?, 'custom', 60, 0, 0, ?, 1)"
                )->execute([
                    $id,
                    $slug,
                    $title,
                    $brandName,
                    $brandTagline,
                    $storedCount,
                    $apiKey,
                ]);
            } catch (Throwable $e3) {
                error_log('[syncpedia] create assessment (' . $slug . '): ' . $e3->getMessage());
                continue;
            }
        }

        if (function_exists('peaklyyInsertCustomQuestions')) {
            peaklyyInsertCustomQuestions($db, $id, $defs);
                try {
                $db->prepare('UPDATE peaklyy_assessments SET question_count = ? WHERE id = ?')->execute([$storedCount, $id]);
                } catch (Throwable $e) {
            }
        }
    }
}
