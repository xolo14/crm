<?php
/**
 * Peaklyy domain question bank — MCQs + structured auto-validated tasks (no free code).
 */
function peaklyyDomainCatalog(): array
{
    return [
        'web_dev' => 'Web Development / IT',
        'uiux' => 'UI/UX Design',
        'content' => 'Content Writing',
        'digital_marketing' => 'Digital Marketing',
        'video_animation' => 'Video & Animation',
    ];
}

function peaklyyDegreeOptions(): array
{
    return [
        'B.Tech / BE - CSE',
        'B.Tech / BE - IT',
        'B.Tech / BE - Other',
        'BCA',
        'MCA',
        'B.Sc / M.Sc',
        'MBA / BBA',
        'Other',
    ];
}

/** @return list<array<string,mixed>> */
function peaklyyQuestionDefinitions(): array
{
    $q = [];

    // ── Domain 1 Web Dev ──
    $q[] = ['web_dev', 'easy', 'mcq', 'What does HTML stand for?', ['a' => 'Hyper Trainer Marking Language', 'b' => 'Hyper Text Markup Language', 'c' => 'High Text Machine Language', 'd' => 'Hyper Text Making Language'], 'b', null, 5];
    $q[] = ['web_dev', 'easy', 'mcq', 'Which tag is used to create a hyperlink?', ['a' => '<link>', 'b' => '<href>', 'c' => '<a>', 'd' => '<hyper>'], 'c', null, 5];
    $q[] = ['web_dev', 'easy', 'mcq', 'Which attribute gives an HTML element a unique identifier?', ['a' => 'class', 'b' => 'name', 'c' => 'id', 'd' => 'key'], 'c', null, 5];
    $q[] = ['web_dev', 'easy', 'mcq', 'What is CSS used for?', ['a' => 'Adding interactivity', 'b' => 'Styling and designing a webpage', 'c' => 'Storing data', 'd' => 'Creating database tables'], 'b', null, 5];
    $q[] = ['web_dev', 'easy', 'mcq', 'What is the full form of IP in "IP Address"?', ['a' => 'Internal Protocol', 'b' => 'Internet Protocol', 'c' => 'Information Protocol', 'd' => 'Interface Protocol'], 'b', null, 5];
    $q[] = ['web_dev', 'easy', 'task', 'Describe a basic webpage (structured — no code). Fill each part.', null, null, [
        'fields' => [
            ['key' => 'heading', 'label' => 'Page heading (what users see at top)', 'min' => 2],
            ['key' => 'paragraph', 'label' => 'One paragraph of page content', 'min' => 15],
            ['key' => 'image_desc', 'label' => 'What image would appear (describe subject/file)', 'min' => 5],
        ],
        'keywords_any' => [],
    ], 5];

    $q[] = ['web_dev', 'medium', 'mcq', 'Which HTML tag is used to create a form?', ['a' => '<input>', 'b' => '<form>', 'c' => '<field>', 'd' => '<data>'], 'b', null, 5];
    $q[] = ['web_dev', 'medium', 'mcq', 'What is the difference between GET and POST methods?', ['a' => 'GET sends data in the URL, POST sends data in the request body', 'b' => 'GET is more secure than POST', 'c' => 'POST cannot send form data', 'd' => 'There is no difference'], 'a', null, 5];
    $q[] = ['web_dev', 'medium', 'mcq', 'Which input type is correct for an email field?', ['a' => 'type="text"', 'b' => 'type="mail"', 'c' => 'type="email"', 'd' => 'type="string"'], 'c', null, 5];
    $q[] = ['web_dev', 'medium', 'mcq', 'What is the purpose of the "required" attribute in a form field?', ['a' => 'It hides the field', 'b' => 'It prevents form submission unless the field is filled', 'c' => 'It changes the field\'s color', 'd' => 'It disables the field'], 'b', null, 5];
    $q[] = ['web_dev', 'medium', 'mcq', 'What is the difference between front-end and back-end development?', ['a' => 'Front-end deals with server/database, back-end deals with UI', 'b' => 'Front-end deals with UI/what users see, back-end deals with server/database logic', 'c' => 'They\'re the same', 'd' => 'Front-end only uses Python'], 'b', null, 5];
    $q[] = ['web_dev', 'medium', 'task', 'Plan a contact form (structured — no code).', null, null, [
        'fields' => [
            ['key' => 'name_field', 'label' => 'Name field: label + input type', 'min' => 4],
            ['key' => 'email_field', 'label' => 'Email field: label + input type', 'min' => 4],
            ['key' => 'message_field', 'label' => 'Message field: label + input type', 'min' => 4],
            ['key' => 'submit', 'label' => 'Submit button label', 'min' => 3],
        ],
        'keywords_any' => ['email', 'name', 'submit', 'message'],
    ], 5];

    $q[] = ['web_dev', 'hard', 'mcq', 'What is the difference between a compiler and an interpreter?', ['a' => 'Compiler translates line-by-line, interpreter translates all at once', 'b' => 'Compiler translates the entire code at once, interpreter translates line-by-line', 'c' => 'Both do the same thing', 'd' => 'Interpreters are used only for HTML'], 'b', null, 5];
    $q[] = ['web_dev', 'hard', 'mcq', 'What does client-side validation mean, as opposed to server-side validation?', ['a' => 'Validation done in the browser before data is sent to the server', 'b' => 'Validation done only after payment', 'c' => 'Validation that only checks passwords', 'd' => 'Validation that happens on the server only'], 'a', null, 5];
    $q[] = ['web_dev', 'hard', 'task', 'Design a registration form plan (structured — no code).', null, null, [
        'fields' => [
            ['key' => 'fields_list', 'label' => 'List fields: Full Name, Email, Password, Confirm Password, Phone', 'min' => 20],
            ['key' => 'input_types', 'label' => 'Correct input types you would use (email, password, tel…)', 'min' => 10],
            ['key' => 'validation', 'label' => 'Validation rules (empty fields + password match)', 'min' => 15],
            ['key' => 'error_msg', 'label' => 'Example error message when validation fails', 'min' => 8],
            ['key' => 'domain_dropdown', 'label' => 'Domain of Interest dropdown options (required)', 'min' => 10],
        ],
        'keywords_any' => ['password', 'email', 'phone', 'domain'],
    ], 10];

    // ── Domain 2 UI/UX ──
    $q[] = ['uiux', 'easy', 'mcq', 'What does UI stand for?', ['a' => 'User Interaction', 'b' => 'User Interface', 'c' => 'Universal Interface', 'd' => 'User Instruction'], 'b', null, 5];
    $q[] = ['uiux', 'easy', 'mcq', 'What does UX stand for?', ['a' => 'User Experience', 'b' => 'User Extension', 'c' => 'User Exchange', 'd' => 'Universal Experience'], 'a', null, 5];
    $q[] = ['uiux', 'easy', 'mcq', 'Which of these is a popular UI design tool?', ['a' => 'Figma', 'b' => 'MySQL', 'c' => 'Postman', 'd' => 'GitHub'], 'a', null, 5];
    $q[] = ['uiux', 'easy', 'mcq', 'What is a "wireframe"?', ['a' => 'A final polished design with colors and images', 'b' => 'A basic skeletal layout showing structure without visual details', 'c' => 'A type of font', 'd' => 'A coding language'], 'b', null, 5];
    $q[] = ['uiux', 'easy', 'task', 'Name 3 UI elements on a login screen.', null, null, [
        'fields' => [
            ['key' => 'el1', 'label' => 'UI element 1', 'min' => 3],
            ['key' => 'el2', 'label' => 'UI element 2', 'min' => 3],
            ['key' => 'el3', 'label' => 'UI element 3', 'min' => 3],
        ],
        'keywords_any' => ['button', 'input', 'logo', 'password', 'email', 'field', 'link', 'checkbox'],
    ], 5];

    $q[] = ['uiux', 'medium', 'mcq', 'What is "visual hierarchy"?', ['a' => 'Arranging elements randomly', 'b' => 'Arranging elements to show their order of importance', 'c' => 'Using only one font size', 'd' => 'Removing all headings'], 'b', null, 5];
    $q[] = ['uiux', 'medium', 'mcq', 'What is the purpose of a "call-to-action" (CTA) button?', ['a' => 'To decorate the page', 'b' => 'To prompt the user to take a specific action', 'c' => 'To close the app', 'd' => 'To show error messages'], 'b', null, 5];
    $q[] = ['uiux', 'medium', 'mcq', 'What is "contrast" used for in design?', ['a' => 'To make text harder to read', 'b' => 'To create visual distinction and improve readability/accessibility', 'c' => 'To match all colors exactly', 'd' => 'To remove color'], 'b', null, 5];
    $q[] = ['uiux', 'medium', 'task', 'List essential UI elements for a good login/registration page (min 6).', null, null, [
        'fields' => [
            ['key' => 'list', 'label' => 'List at least 6 UI elements (comma or line separated)', 'min' => 30],
        ],
        'min_items' => 6,
    ], 5];
    $q[] = ['uiux', 'medium', 'task', 'Critique: registration form has 15 mandatory fields including Mother\'s maiden name. Problems + fixes.', null, null, [
        'fields' => [
            ['key' => 'problems', 'label' => 'UX problems you see', 'min' => 20],
            ['key' => 'fixes', 'label' => 'How you would fix them', 'min' => 20],
        ],
        'keywords_any' => ['field', 'mandatory', 'drop', 'friction', 'long', 'privacy', 'optional', 'step'],
    ], 5];

    $q[] = ['uiux', 'hard', 'mcq', 'What is the difference between "low-fidelity" and "high-fidelity" prototypes?', ['a' => 'Low-fidelity is a rough sketch/wireframe; high-fidelity is a detailed, near-final interactive design', 'b' => 'They are identical', 'c' => 'High-fidelity is always hand-drawn', 'd' => 'Low-fidelity is only used for backend testing'], 'a', null, 5];
    $q[] = ['uiux', 'hard', 'mcq', 'What is "Fitts\'s Law" in UX design?', ['a' => 'A law about color theory', 'b' => 'A predictive model stating time-to-reach-target depends on size and distance', 'c' => 'A rule about font pairing', 'd' => 'A law about database design'], 'b', null, 5];
    $q[] = ['uiux', 'hard', 'task', 'Design a student registration page UI (describe — no Figma file required).', null, null, [
        'fields' => [
            ['key' => 'layout', 'label' => 'Layout (header/logo, fields, CTA)', 'min' => 30],
            ['key' => 'colors', 'label' => 'Color / spacing / font choices and why', 'min' => 20],
            ['key' => 'progress', 'label' => 'Progress/step indicator approach', 'min' => 10],
        ],
        'keywords_any' => ['button', 'register', 'field', 'cta'],
    ], 10];
    $q[] = ['uiux', 'hard', 'task', 'Users drop off on registration. List 3 UI/UX reasons + redesign fixes.', null, null, [
        'fields' => [
            ['key' => 'r1', 'label' => 'Reason 1 + fix', 'min' => 15],
            ['key' => 'r2', 'label' => 'Reason 2 + fix', 'min' => 15],
            ['key' => 'r3', 'label' => 'Reason 3 + fix', 'min' => 15],
        ],
        'keywords_any' => [],
    ], 5];
    $q[] = ['uiux', 'hard', 'task', 'Accessibility for color-blind / visually impaired users (min 2 techniques).', null, null, [
        'fields' => [
            ['key' => 't1', 'label' => 'Technique 1', 'min' => 10],
            ['key' => 't2', 'label' => 'Technique 2', 'min' => 10],
        ],
        'keywords_any' => ['contrast', 'label', 'alt', 'aria', 'screen', 'color', 'text', 'focus', 'keyboard'],
    ], 5];

    // ── Domain 3 Content ──
    $q[] = ['content', 'easy', 'mcq', 'What is the primary purpose of a "call-to-action" in content writing?', ['a' => 'To confuse the reader', 'b' => 'To prompt the reader to take a specific action', 'c' => 'To end the article', 'd' => 'To add humor'], 'b', null, 5];
    $q[] = ['content', 'easy', 'mcq', 'What does "SEO-friendly content" mean?', ['a' => 'Content written only for search engines, not readers', 'b' => 'Content optimized to rank well in search engines while staying readable', 'c' => 'Content with no headings', 'd' => 'Content written in one long paragraph'], 'b', null, 5];
    $q[] = ['content', 'easy', 'mcq', 'What is a "headline" in content writing?', ['a' => 'The last line of an article', 'b' => 'The title that grabs attention and summarizes the piece', 'c' => 'A footnote', 'd' => 'A hyperlink'], 'b', null, 5];
    $q[] = ['content', 'easy', 'mcq', 'Which of these is an example of a content format?', ['a' => 'Blog post', 'b' => 'Database', 'c' => 'Compiler', 'd' => 'Server'], 'a', null, 5];
    $q[] = ['content', 'easy', 'task', 'Write a 3-line product description for a reusable water bottle.', null, null, [
        'fields' => [
            ['key' => 'line1', 'label' => 'Line 1', 'min' => 8],
            ['key' => 'line2', 'label' => 'Line 2', 'min' => 8],
            ['key' => 'line3', 'label' => 'Line 3', 'min' => 8],
        ],
        'keywords_any' => ['bottle', 'water', 'reuse', 'eco', 'hydrat', 'drink'],
    ], 5];
    $q[] = ['content', 'easy', 'task', 'Write a catchy headline (under 10 words) for "5 study tips for exams."', null, null, [
        'fields' => [
            ['key' => 'headline', 'label' => 'Headline (max ~10 words)', 'min' => 8, 'max_words' => 12],
        ],
        'keywords_any' => ['study', 'exam', 'tip', 'score', 'focus', 'learn'],
    ], 5];

    $q[] = ['content', 'medium', 'mcq', 'What is "tone of voice" in content writing?', ['a' => 'The volume at which content is read aloud', 'b' => 'The personality/style a brand uses consistently in its writing', 'c' => 'The font size used', 'd' => 'The length of the article'], 'b', null, 5];
    $q[] = ['content', 'medium', 'mcq', 'What is the difference between "copywriting" and "content writing"?', ['a' => 'They are exactly the same', 'b' => 'Copywriting persuades for immediate action (ads/sales); content writing informs/engages over time (blogs/articles)', 'c' => 'Copywriting is always longer', 'd' => 'Content writing is only for social media'], 'b', null, 5];
    $q[] = ['content', 'medium', 'mcq', 'What does "keyword density" refer to in SEO writing?', ['a' => 'The number of images on a page', 'b' => 'How often a target keyword appears relative to total word count', 'c' => 'The font weight of a keyword', 'd' => 'The number of backlinks'], 'b', null, 5];
    $q[] = ['content', 'medium', 'task', 'Rewrite to make more engaging: "Our app helps you manage tasks."', null, null, [
        'fields' => [
            ['key' => 'rewrite', 'label' => 'Your rewritten sentence', 'min' => 20],
        ],
        'keywords_any' => [],
    ], 5];
    $q[] = ['content', 'medium', 'task', 'Write a ~100-word blog intro: "Why students should start freelancing early." Hook in first line.', null, null, [
        'fields' => [
            ['key' => 'intro', 'label' => 'Blog intro (~80–120 words)', 'min' => 120],
        ],
        'keywords_any' => ['freelance', 'student', 'skill', 'earn', 'career', 'experience'],
    ], 5];

    $q[] = ['content', 'hard', 'mcq', 'What is "content repurposing"?', ['a' => 'Deleting old content', 'b' => 'Transforming one piece of content into multiple formats (e.g., blog to video script to social post)', 'c' => 'Writing content only once and never reusing it', 'd' => 'Copying competitor content'], 'b', null, 5];
    $q[] = ['content', 'hard', 'task', 'Edit this poor paragraph: identify 3 issues + rewrite.', null, null, [
        'fields' => [
            ['key' => 'issues', 'label' => 'At least 3 issues', 'min' => 20],
            ['key' => 'rewrite', 'label' => 'Improved rewrite', 'min' => 40],
        ],
        'keywords_any' => [],
    ], 10];
    $q[] = ['content', 'hard', 'task', 'Website copy for a startup with zero brand awareness — questions for founder + tone.', null, null, [
        'fields' => [
            ['key' => 'questions', 'label' => 'Questions you would ask the founder', 'min' => 30],
            ['key' => 'tone', 'label' => 'Tone you would choose and why', 'min' => 20],
        ],
        'keywords_any' => [],
    ], 5];
    $q[] = ['content', 'hard', 'task', 'Rewrite casually for Instagram: "Our platform connects students with verified job opportunities through an AI-driven matching system."', null, null, [
        'fields' => [
            ['key' => 'caption', 'label' => 'Casual Instagram-style rewrite', 'min' => 25],
        ],
        'keywords_any' => ['student', 'job', 'gig', 'match', 'peaklyy', 'work', 'opportun'],
    ], 5];

    // ── Domain 4 Digital Marketing ──
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What does SEO stand for?', ['a' => 'Search Engine Optimization', 'b' => 'Site Engine Operation', 'c' => 'Search Engagement Online', 'd' => 'System Engine Optimization'], 'a', null, 5];
    $q[] = ['digital_marketing', 'easy', 'mcq', 'Which of these is a social media platform used for marketing?', ['a' => 'Figma', 'b' => 'Instagram', 'c' => 'MySQL', 'd' => 'GitHub'], 'b', null, 5];
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What is a "target audience"?', ['a' => 'Everyone on the internet', 'b' => 'The specific group of people a campaign is designed to reach', 'c' => 'The marketing team', 'd' => 'A type of ad format'], 'b', null, 5];
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What is the purpose of a hashtag on social media?', ['a' => 'To make posts private', 'b' => 'To categorize content and increase discoverability', 'c' => 'To delete a post', 'd' => 'To edit an image'], 'b', null, 5];
    $q[] = ['digital_marketing', 'easy', 'task', 'Suggest 3 hashtags for a student internship platform post.', null, null, [
        'fields' => [
            ['key' => 'h1', 'label' => 'Hashtag 1', 'min' => 2],
            ['key' => 'h2', 'label' => 'Hashtag 2', 'min' => 2],
            ['key' => 'h3', 'label' => 'Hashtag 3', 'min' => 2],
        ],
        'keywords_any' => ['#', 'intern', 'student', 'career', 'job', 'peaklyy', 'gig'],
    ], 5];

    $q[] = ['digital_marketing', 'medium', 'mcq', 'What does "CTR" stand for in digital marketing?', ['a' => 'Content Type Rating', 'b' => 'Click-Through Rate', 'c' => 'Customer Trust Report', 'd' => 'Content Tracking Result'], 'b', null, 5];
    $q[] = ['digital_marketing', 'medium', 'mcq', 'What is "A/B testing" used for in marketing campaigns?', ['a' => 'Testing app bugs', 'b' => 'Comparing two versions of an ad/content to see which performs better', 'c' => 'Testing server speed', 'd' => 'Checking grammar'], 'b', null, 5];
    $q[] = ['digital_marketing', 'medium', 'mcq', 'What is the difference between "organic reach" and "paid reach"?', ['a' => 'They are the same', 'b' => 'Organic reach is unpaid audience exposure; paid reach comes from advertising spend', 'c' => 'Paid reach is always free', 'd' => 'Organic reach only applies to email'], 'b', null, 5];
    $q[] = ['digital_marketing', 'medium', 'mcq', 'What is a "sales funnel"?', ['a' => 'A single advertisement', 'b' => 'The step-by-step journey a customer takes from awareness to purchase', 'c' => 'A type of email', 'd' => 'A social media filter'], 'b', null, 5];
    $q[] = ['digital_marketing', 'medium', 'task', 'Write a short Instagram caption (2–3 lines) for a back-to-school student discount.', null, null, [
        'fields' => [
            ['key' => 'caption', 'label' => 'Caption (2–3 lines)', 'min' => 25],
        ],
        'keywords_any' => ['student', 'school', 'discount', 'offer', 'back', '%', 'deal'],
    ], 5];

    $q[] = ['digital_marketing', 'hard', 'mcq', 'What does "CAC" (Customer Acquisition Cost) measure?', ['a' => 'The total revenue of a company', 'b' => 'The cost incurred to acquire one new customer', 'c' => 'The number of employees in marketing', 'd' => 'The price of the product'], 'b', null, 5];
    $q[] = ['digital_marketing', 'hard', 'task', '₹10,000/month social strategy for student sign-ups — platforms, content, metrics.', null, null, [
        'fields' => [
            ['key' => 'platforms', 'label' => 'Platforms + why', 'min' => 15],
            ['key' => 'content', 'label' => 'Content types', 'min' => 15],
            ['key' => 'metrics', 'label' => 'Metrics to track', 'min' => 10],
        ],
        'keywords_any' => ['instagram', 'meta', 'youtube', 'linkedin', 'ctr', 'sign', 'cpc', 'reach'],
    ], 10];
    $q[] = ['digital_marketing', 'hard', 'task', 'Design a 3-post Peaklyy campaign for college students (awareness / engagement / conversion).', null, null, [
        'fields' => [
            ['key' => 'post1', 'label' => 'Post 1 (awareness)', 'min' => 15],
            ['key' => 'post2', 'label' => 'Post 2 (engagement)', 'min' => 15],
            ['key' => 'post3', 'label' => 'Post 3 (conversion)', 'min' => 15],
        ],
        'keywords_any' => ['peaklyy', 'student', 'sign', 'learn', 'earn'],
    ], 5];
    $q[] = ['digital_marketing', 'hard', 'task', 'High impressions, very low CTR — what\'s wrong and what to test first?', null, null, [
        'fields' => [
            ['key' => 'problem', 'label' => 'What could be going wrong', 'min' => 20],
            ['key' => 'test', 'label' => 'What you would test first', 'min' => 15],
        ],
        'keywords_any' => ['creative', 'cta', 'headline', 'audience', 'offer', 'hook', 'thumbnail'],
    ], 5];

    // ── Domain 5 Video ──
    $q[] = ['video_animation', 'easy', 'mcq', 'What does "FPS" stand for in video?', ['a' => 'Frames Per Second', 'b' => 'File Processing System', 'c' => 'Fast Playback Speed', 'd' => 'Frame Position Setting'], 'a', null, 5];
    $q[] = ['video_animation', 'easy', 'mcq', 'Which of these is a video editing software?', ['a' => 'Adobe Premiere Pro', 'b' => 'MySQL', 'c' => 'Figma', 'd' => 'Postman'], 'a', null, 5];
    $q[] = ['video_animation', 'easy', 'mcq', 'What is a "storyboard" used for?', ['a' => 'Storing files', 'b' => 'Planning the visual sequence of a video before production', 'c' => 'Editing audio only', 'd' => 'Writing code'], 'b', null, 5];
    $q[] = ['video_animation', 'easy', 'mcq', 'What is the difference between 2D and 3D animation?', ['a' => '2D uses flat/two-dimensional visuals; 3D uses depth and volume', 'b' => 'They are the same', 'c' => '3D is always hand-drawn', 'd' => '2D can only be black and white'], 'a', null, 5];
    $q[] = ['video_animation', 'easy', 'task', '4-shot storyboard for a 15s promo: students earning through gigs (one line per shot).', null, null, [
        'fields' => [
            ['key' => 's1', 'label' => 'Shot 1', 'min' => 8],
            ['key' => 's2', 'label' => 'Shot 2', 'min' => 8],
            ['key' => 's3', 'label' => 'Shot 3', 'min' => 8],
            ['key' => 's4', 'label' => 'Shot 4', 'min' => 8],
        ],
        'keywords_any' => ['student', 'gig', 'earn', 'app', 'phone', 'work'],
    ], 5];

    $q[] = ['video_animation', 'medium', 'mcq', 'What is a "transition" in video editing?', ['a' => 'The final export step', 'b' => 'An effect used to move smoothly from one scene/clip to another', 'c' => 'A type of audio file', 'd' => 'A camera angle'], 'b', null, 5];
    $q[] = ['video_animation', 'medium', 'mcq', 'What is "color grading" in video editing?', ['a' => 'Adjusting and enhancing the color/tone of footage for mood and consistency', 'b' => 'Deleting unwanted scenes', 'c' => 'Adding subtitles', 'd' => 'Compressing file size'], 'a', null, 5];
    $q[] = ['video_animation', 'medium', 'mcq', 'What does "aspect ratio" refer to?', ['a' => 'The audio quality of a video', 'b' => 'The proportional relationship between a video\'s width and height (e.g., 16:9, 9:16)', 'c' => 'The number of scenes in a video', 'd' => 'The frame rate'], 'b', null, 5];
    $q[] = ['video_animation', 'medium', 'task', '30s Instagram Reel: "How Peaklyy works" — shot-by-shot breakdown.', null, null, [
        'fields' => [
            ['key' => 'breakdown', 'label' => 'Shot-by-shot (with approximate seconds)', 'min' => 40],
        ],
        'keywords_any' => ['peaklyy', 'student', 'sign', 'gig', 'match', 'earn'],
    ], 5];

    $q[] = ['video_animation', 'hard', 'mcq', 'What is the difference between "keyframe animation" and "motion tracking"?', ['a' => 'They\'re identical techniques', 'b' => 'Keyframe animation defines specific points to create movement; motion tracking follows a real object\'s movement to attach effects to it', 'c' => 'Motion tracking is only for audio', 'd' => 'Keyframe animation is only used in 3D'], 'b', null, 5];
    $q[] = ['video_animation', 'hard', 'task', 'Pitch a 60s Peaklyy explainer (hook 3s + core message + CTA + visual style).', null, null, [
        'fields' => [
            ['key' => 'hook', 'label' => 'Hook (first 3 seconds)', 'min' => 10],
            ['key' => 'core', 'label' => 'Core message', 'min' => 20],
            ['key' => 'cta', 'label' => 'Call-to-action', 'min' => 8],
            ['key' => 'style', 'label' => 'Visual style', 'min' => 10],
        ],
        'keywords_any' => ['peaklyy', 'student', 'learn', 'earn', 'sign'],
    ], 10];
    $q[] = ['video_animation', 'hard', 'task', 'Video "feels boring" — 3 things you\'d check/change (pacing, transitions, music…).', null, null, [
        'fields' => [
            ['key' => 'c1', 'label' => 'Change 1', 'min' => 10],
            ['key' => 'c2', 'label' => 'Change 2', 'min' => 10],
            ['key' => 'c3', 'label' => 'Change 3', 'min' => 10],
        ],
        'keywords_any' => ['pace', 'music', 'transition', 'visual', 'cut', 'broll', 'text', 'hook'],
    ], 5];
    $q[] = ['video_animation', 'hard', 'task', 'Describe a 2–3s premium logo reveal (movement, timing, effects).', null, null, [
        'fields' => [
            ['key' => 'reveal', 'label' => 'Logo reveal description', 'min' => 30],
        ],
        'keywords_any' => ['scale', 'fade', 'ease', 'glow', 'slide', 'opacity', 'motion', 'timing'],
    ], 5];

    $out = [];
    $i = 0;
    foreach ($q as $row) {
        $i++;
        $out[] = [
            'domain_key' => $row[0],
            'level_key' => $row[1],
            'q_type' => $row[2],
            'prompt' => $row[3],
            'options' => $row[4],
            'correct_option' => $row[5],
            'task_schema' => $row[6],
            'points' => $row[7],
            'sort_order' => $i,
        ];
    }
    return $out;
}
