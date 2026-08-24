<?php
/**
 * Peaklyy beginner-friendly student assessment bank.
 * 11 domains × (15 MCQs + 1 very basic practical task).
 * Source: Peaklyy_Beginner_Friendly_Student_Assessment.docx
 * Bank version: beginner_11x15_task_v1
 * Per attempt: all 15 domain MCQs + 1 domain task (untimed).
 */
function peaklyyQuestionBankVersion(): string
{
    return 'beginner_11x15_task_v1';
}

function peaklyyDomainMcqCount(): int
{
    return 15;
}

function peaklyyDomainTaskCount(): int
{
    return 1;
}

function peaklyyDomainQuestionCount(): int
{
    return peaklyyDomainMcqCount() + peaklyyDomainTaskCount();
}

function peaklyyDomainCatalog(): array
{
    return [
        'python' => 'IT & Development - Python',
        'javascript' => 'IT & Development - JavaScript',
        'html_css' => 'IT & Development - HTML & CSS',
        'java' => 'IT & Development - Java',
        'ui_design' => 'Design & Creation - UI Design',
        'writing_translation' => 'Writing & Translation',
        'business_finance' => 'Business & Finance',
        'digital_marketing' => 'Digital Marketing',
        'data_analytics' => 'Data Analytics',
        'video_animation' => 'Video & Animation',
        'photography' => 'Photography',
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

    // ── IT & Development - Python ──
    $q[] = ['python', 'easy', 'mcq', 'Which keyword is used to define a function in Python?', ['a' => 'func', 'b' => 'def', 'c' => 'function', 'd' => 'method'], 'b', null, 1];
    $q[] = ['python', 'easy', 'mcq', 'Which symbol starts a single-line comment in Python?', ['a' => '//', 'b' => '#', 'c' => '--', 'd' => '/*'], 'b', null, 1];
    $q[] = ['python', 'easy', 'mcq', 'Which of these is a Python list?', ['a' => '(1, 2, 3)', 'b' => '[1, 2, 3]', 'c' => '{1, 2, 3}', 'd' => '<1, 2, 3>'], 'b', null, 1];
    $q[] = ['python', 'easy', 'mcq', 'What does len() return when used with a list?', ['a' => 'The first item', 'b' => 'The number of items', 'c' => 'The last item', 'd' => 'The data type'], 'b', null, 1];
    $q[] = ['python', 'easy', 'mcq', 'Which data type is used for True or False?', ['a' => 'String', 'b' => 'Boolean', 'c' => 'List', 'd' => 'Float'], 'b', null, 1];
    $q[] = ['python', 'easy', 'mcq', 'What is the output of print(2 + 3)?', ['a' => '23', 'b' => '5', 'c' => '6', 'd' => 'Error'], 'b', null, 1];
    $q[] = ['python', 'easy', 'mcq', 'Which keyword is commonly used to make a decision in Python?', ['a' => 'if', 'b' => 'when', 'c' => 'check', 'd' => 'case'], 'a', null, 1];
    $q[] = ['python', 'easy', 'mcq', 'Which loop is commonly used to repeat over items in a list?', ['a' => 'repeat', 'b' => 'for', 'c' => 'loop', 'd' => 'each'], 'b', null, 1];
    $q[] = ['python', 'easy', 'mcq', 'Which of these stores a whole number?', ['a' => 'int', 'b' => 'str', 'c' => 'bool', 'd' => 'list'], 'a', null, 1];
    $q[] = ['python', 'easy', 'mcq', 'What does print() do?', ['a' => 'Deletes data', 'b' => 'Displays output', 'c' => 'Creates a file', 'd' => 'Imports Python'], 'b', null, 1];
    $q[] = ['python', 'easy', 'mcq', 'How do you assign the value 10 to a variable named x?', ['a' => '10 = x', 'b' => 'x == 10', 'c' => 'x = 10', 'd' => 'int x 10'], 'c', null, 1];
    $q[] = ['python', 'easy', 'mcq', 'Which symbol is used for multiplication in Python?', ['a' => 'x', 'b' => '*', 'c' => '%', 'd' => '^'], 'b', null, 1];
    $q[] = ['python', 'easy', 'mcq', 'What does input() normally do?', ['a' => 'Receives input from the user', 'b' => 'Prints a result', 'c' => 'Stops the program', 'd' => 'Creates a list'], 'a', null, 1];
    $q[] = ['python', 'easy', 'mcq', 'Which of these is a Python string?', ['a' => '25', 'b' => 'True', 'c' => '"Peaklyy"', 'd' => '[25]'], 'c', null, 1];
    $q[] = ['python', 'easy', 'mcq', 'What is the purpose of indentation in Python?', ['a' => 'It helps define code blocks', 'b' => 'It changes the screen color', 'c' => 'It installs Python', 'd' => 'It creates comments'], 'a', null, 1];

    // ── IT & Development - JavaScript ──
    $q[] = ['javascript', 'easy', 'mcq', 'Which keyword can be used to declare a variable in JavaScript?', ['a' => 'let', 'b' => 'define', 'c' => 'int', 'd' => 'variable'], 'a', null, 1];
    $q[] = ['javascript', 'easy', 'mcq', 'Which symbol starts a single-line comment in JavaScript?', ['a' => '#', 'b' => '//', 'c' => '<!--', 'd' => '--'], 'b', null, 1];
    $q[] = ['javascript', 'easy', 'mcq', 'What does console.log() normally do?', ['a' => 'Displays output in the console', 'b' => 'Creates a database', 'c' => 'Deletes a variable', 'd' => 'Starts a server'], 'a', null, 1];
    $q[] = ['javascript', 'easy', 'mcq', 'What is the type of "Hello" in JavaScript?', ['a' => 'number', 'b' => 'string', 'c' => 'boolean', 'd' => 'object'], 'b', null, 1];
    $q[] = ['javascript', 'easy', 'mcq', 'Which value represents true or false?', ['a' => 'Boolean', 'b' => 'String', 'c' => 'Array', 'd' => 'Number'], 'a', null, 1];
    $q[] = ['javascript', 'easy', 'mcq', 'Which array method adds an item to the end?', ['a' => 'pop()', 'b' => 'push()', 'c' => 'shift()', 'd' => 'remove()'], 'b', null, 1];
    $q[] = ['javascript', 'easy', 'mcq', 'What does .length give for an array?', ['a' => 'Its first item', 'b' => 'Its number of items', 'c' => 'Its data type', 'd' => 'Its last item'], 'b', null, 1];
    $q[] = ['javascript', 'easy', 'mcq', 'Which operator checks equality without converting the types?', ['a' => '=', 'b' => '==', 'c' => '===', 'd' => '!='], 'c', null, 1];
    $q[] = ['javascript', 'easy', 'mcq', 'Which keyword is commonly used to define a function?', ['a' => 'def', 'b' => 'function', 'c' => 'func', 'd' => 'method'], 'b', null, 1];
    $q[] = ['javascript', 'easy', 'mcq', 'Which symbol is commonly used for multiplication?', ['a' => 'x', 'b' => '*', 'c' => '%', 'd' => '^'], 'b', null, 1];
    $q[] = ['javascript', 'easy', 'mcq', 'What is an array used for?', ['a' => 'Storing multiple values', 'b' => 'Styling a page', 'c' => 'Creating a database', 'd' => 'Writing comments'], 'a', null, 1];
    $q[] = ['javascript', 'easy', 'mcq', 'What does document.getElementById() help you do?', ['a' => 'Find an HTML element by its id', 'b' => 'Create a password', 'c' => 'Start Python', 'd' => 'Delete the browser'], 'a', null, 1];
    $q[] = ['javascript', 'easy', 'mcq', 'Which keyword can declare a constant value?', ['a' => 'constant', 'b' => 'const', 'c' => 'fixed', 'd' => 'static'], 'b', null, 1];
    $q[] = ['javascript', 'easy', 'mcq', 'What does an if statement do?', ['a' => 'Makes a decision based on a condition', 'b' => 'Loops forever', 'c' => 'Imports a library', 'd' => 'Creates an image'], 'a', null, 1];
    $q[] = ['javascript', 'easy', 'mcq', 'Which file extension is commonly used for JavaScript files?', ['a' => '.java', 'b' => '.js', 'c' => '.py', 'd' => '.css'], 'b', null, 1];

    // ── IT & Development - HTML & CSS ──
    $q[] = ['html_css', 'easy', 'mcq', 'What does HTML mainly define?', ['a' => 'The structure/content of a webpage', 'b' => 'Database tables', 'c' => 'Server hardware', 'd' => 'Video editing'], 'a', null, 1];
    $q[] = ['html_css', 'easy', 'mcq', 'What does CSS mainly control?', ['a' => 'The appearance and layout of a webpage', 'b' => 'Database queries', 'c' => 'Python code', 'd' => 'Email delivery'], 'a', null, 1];
    $q[] = ['html_css', 'easy', 'mcq', 'Which HTML tag creates a main heading?', ['a' => '<h1>', 'b' => '<head>', 'c' => '<title>', 'd' => '<heading>'], 'a', null, 1];
    $q[] = ['html_css', 'easy', 'mcq', 'Which HTML tag creates a link?', ['a' => '<a>', 'b' => '<linkto>', 'c' => '<url>', 'd' => '<href>'], 'a', null, 1];
    $q[] = ['html_css', 'easy', 'mcq', 'Which tag is used to display an image?', ['a' => '<image>', 'b' => '<img>', 'c' => '<picturefile>', 'd' => '<src>'], 'b', null, 1];
    $q[] = ['html_css', 'easy', 'mcq', 'What is the purpose of alt text on an image?', ['a' => 'Describe the image for accessibility/fallback', 'b' => 'Change image size', 'c' => 'Add animation', 'd' => 'Compress the image'], 'a', null, 1];
    $q[] = ['html_css', 'easy', 'mcq', 'Which CSS property changes text color?', ['a' => 'font-color', 'b' => 'color', 'c' => 'text-color', 'd' => 'foreground'], 'b', null, 1];
    $q[] = ['html_css', 'easy', 'mcq', 'Which CSS property changes the background color?', ['a' => 'bgcolor', 'b' => 'background-color', 'c' => 'background-image-only', 'd' => 'fill'], 'b', null, 1];
    $q[] = ['html_css', 'easy', 'mcq', 'What does CSS stand for?', ['a' => 'Cascading Style Sheets', 'b' => 'Computer Style System', 'c' => 'Creative Screen Sheets', 'd' => 'Color Style Syntax'], 'a', null, 1];
    $q[] = ['html_css', 'easy', 'mcq', 'Which CSS property adds space inside an element\'s border?', ['a' => 'margin', 'b' => 'padding', 'c' => 'spacing', 'd' => 'gap-only'], 'b', null, 1];
    $q[] = ['html_css', 'easy', 'mcq', 'Which CSS property adds space outside an element\'s border?', ['a' => 'padding', 'b' => 'margin', 'c' => 'inside-space', 'd' => 'outline'], 'b', null, 1];
    $q[] = ['html_css', 'easy', 'mcq', 'What does <p> usually represent?', ['a' => 'A paragraph', 'b' => 'A picture', 'c' => 'A page', 'd' => 'A popup'], 'a', null, 1];
    $q[] = ['html_css', 'easy', 'mcq', 'Which HTML tag creates an unordered list?', ['a' => '<ol>', 'b' => '<ul>', 'c' => '<list>', 'd' => '<li-only>'], 'b', null, 1];
    $q[] = ['html_css', 'easy', 'mcq', 'What does an HTML attribute provide?', ['a' => 'Extra information about an element', 'b' => 'A database connection', 'c' => 'A CSS animation', 'd' => 'A server password'], 'a', null, 1];
    $q[] = ['html_css', 'easy', 'mcq', 'Which CSS value hides an element and removes it from layout?', ['a' => 'display: none', 'b' => 'visibility: show', 'c' => 'hide: true', 'd' => 'remove: css'], 'a', null, 1];

    // ── IT & Development - Java ──
    $q[] = ['java', 'easy', 'mcq', 'Which keyword is used to create a new object in Java?', ['a' => 'new', 'b' => 'create', 'c' => 'object', 'd' => 'make'], 'a', null, 1];
    $q[] = ['java', 'easy', 'mcq', 'Which method is the usual entry point of a Java application?', ['a' => 'start()', 'b' => 'main()', 'c' => 'run()', 'd' => 'begin()'], 'b', null, 1];
    $q[] = ['java', 'easy', 'mcq', 'Which keyword defines a class?', ['a' => 'class', 'b' => 'Class', 'c' => 'define', 'd' => 'struct'], 'a', null, 1];
    $q[] = ['java', 'easy', 'mcq', 'Which type stores whole numbers such as 10?', ['a' => 'int', 'b' => 'String', 'c' => 'boolean', 'd' => 'double-text'], 'a', null, 1];
    $q[] = ['java', 'easy', 'mcq', 'Which type stores True or False?', ['a' => 'boolean', 'b' => 'String', 'c' => 'int', 'd' => 'char[]'], 'a', null, 1];
    $q[] = ['java', 'easy', 'mcq', 'Which method prints output to the console?', ['a' => 'console.log()', 'b' => 'System.out.println()', 'c' => 'print.console()', 'd' => 'echo()'], 'b', null, 1];
    $q[] = ['java', 'easy', 'mcq', 'What symbol normally ends a Java statement?', ['a' => '.', 'b' => ',', 'c' => ';', 'd' => ':'], 'c', null, 1];
    $q[] = ['java', 'easy', 'mcq', 'Which is a valid Java single-line comment?', ['a' => '# comment', 'b' => '// comment', 'c' => '<!-- comment -->', 'd' => '\' comment'], 'b', null, 1];
    $q[] = ['java', 'easy', 'mcq', 'Which file extension is used for Java source code?', ['a' => '.class', 'b' => '.java', 'c' => '.js', 'd' => '.py'], 'b', null, 1];
    $q[] = ['java', 'easy', 'mcq', 'Which type is commonly used for text such as \'Hello\'?', ['a' => 'String', 'b' => 'char', 'c' => 'text', 'd' => 'varchar'], 'a', null, 1];
    $q[] = ['java', 'easy', 'mcq', 'How do you declare an integer variable x?', ['a' => 'x int;', 'b' => 'int x;', 'c' => 'integer x;', 'd' => 'number x;'], 'b', null, 1];
    $q[] = ['java', 'easy', 'mcq', 'What does an if statement do?', ['a' => 'Makes a decision based on a condition', 'b' => 'Repeats code automatically', 'c' => 'Creates a package', 'd' => 'Prints text'], 'a', null, 1];
    $q[] = ['java', 'easy', 'mcq', 'Which loop is useful for repeating while a condition is true?', ['a' => 'while', 'b' => 'repeat-if', 'c' => 'loopif', 'd' => 'during'], 'a', null, 1];
    $q[] = ['java', 'easy', 'mcq', 'Which keyword is used to return a value from a method?', ['a' => 'give', 'b' => 'return', 'c' => 'send', 'd' => 'back'], 'b', null, 1];
    $q[] = ['java', 'easy', 'mcq', 'What does System.out.println("Hello") do?', ['a' => 'Prints Hello', 'b' => 'Reads Hello', 'c' => 'Deletes Hello', 'd' => 'Creates a class'], 'a', null, 1];

    // ── Design & Creation - UI Design ──
    $q[] = ['ui_design', 'easy', 'mcq', 'What does UI stand for?', ['a' => 'User Interface', 'b' => 'User Instruction', 'c' => 'Universal Interaction', 'd' => 'User Internet'], 'a', null, 1];
    $q[] = ['ui_design', 'easy', 'mcq', 'What is a wireframe?', ['a' => 'A simple layout/blueprint of a screen', 'b' => 'A finished animation', 'c' => 'A database', 'd' => 'A programming language'], 'a', null, 1];
    $q[] = ['ui_design', 'easy', 'mcq', 'Which color model is commonly used for screen design?', ['a' => 'CMYK', 'b' => 'RGB', 'c' => 'Pantone', 'd' => 'Grayscale only'], 'b', null, 1];
    $q[] = ['ui_design', 'easy', 'mcq', 'What is a component in Figma?', ['a' => 'A reusable design element', 'b' => 'A video file', 'c' => 'A database table', 'd' => 'A font family'], 'a', null, 1];
    $q[] = ['ui_design', 'easy', 'mcq', 'What is contrast in visual design?', ['a' => 'Difference that helps elements stand out', 'b' => 'Number of screens', 'c' => 'Image file size', 'd' => 'Amount of text'], 'a', null, 1];
    $q[] = ['ui_design', 'easy', 'mcq', 'What is typography mainly concerned with?', ['a' => 'The design and arrangement of text', 'b' => 'Database structure', 'c' => 'Video speed', 'd' => 'Photography lighting'], 'a', null, 1];
    $q[] = ['ui_design', 'easy', 'mcq', 'What is a button primarily used for in a UI?', ['a' => 'To let the user perform an action', 'b' => 'To store a database', 'c' => 'To resize a monitor', 'd' => 'To write code'], 'a', null, 1];
    $q[] = ['ui_design', 'easy', 'mcq', 'What is a navigation bar used for?', ['a' => 'Helping users move between sections/pages', 'b' => 'Editing photos', 'c' => 'Writing CSS', 'd' => 'Compressing images'], 'a', null, 1];
    $q[] = ['ui_design', 'easy', 'mcq', 'What is whitespace?', ['a' => 'Empty visual space around or between elements', 'b' => 'A white image only', 'c' => 'Unused code', 'd' => 'A font style'], 'a', null, 1];
    $q[] = ['ui_design', 'easy', 'mcq', 'What does alignment help with?', ['a' => 'Keeping elements visually organized', 'b' => 'Increasing file size', 'c' => 'Changing programming language', 'd' => 'Adding sound'], 'a', null, 1];
    $q[] = ['ui_design', 'easy', 'mcq', 'What is a color palette?', ['a' => 'A selected set of colors used in a design', 'b' => 'A list of fonts only', 'c' => 'A photo folder', 'd' => 'A coding library'], 'a', null, 1];
    $q[] = ['ui_design', 'easy', 'mcq', 'What is a user flow?', ['a' => 'The sequence of steps a user follows to complete a goal', 'b' => 'A color gradient', 'c' => 'A font list', 'd' => 'A file format'], 'a', null, 1];
    $q[] = ['ui_design', 'easy', 'mcq', 'What does consistency mean in UI design?', ['a' => 'Using similar patterns and styles throughout the interface', 'b' => 'Using one color only', 'c' => 'Using no images', 'd' => 'Changing layouts on every screen'], 'a', null, 1];
    $q[] = ['ui_design', 'easy', 'mcq', 'What is a prototype?', ['a' => 'An interactive or testable version of a design', 'b' => 'A final database', 'c' => 'A photo filter', 'd' => 'A programming compiler'], 'a', null, 1];
    $q[] = ['ui_design', 'easy', 'mcq', 'What is hierarchy in design?', ['a' => 'Showing which information is more important through visual emphasis', 'b' => 'Making everything the same size', 'c' => 'Removing all spacing', 'd' => 'Using only black and white'], 'a', null, 1];

    // ── Writing & Translation ──
    $q[] = ['writing_translation', 'easy', 'mcq', 'Which sentence is grammatically correct?', ['a' => 'She go to college.', 'b' => 'She goes to college.', 'c' => 'She going college.', 'd' => 'She gone to college.'], 'b', null, 1];
    $q[] = ['writing_translation', 'easy', 'mcq', 'Which word is a synonym of \'happy\'?', ['a' => 'Sad', 'b' => 'Joyful', 'c' => 'Angry', 'd' => 'Tired'], 'b', null, 1];
    $q[] = ['writing_translation', 'easy', 'mcq', 'Which punctuation mark normally ends a question?', ['a' => '.', 'b' => '!', 'c' => '?', 'd' => ';'], 'c', null, 1];
    $q[] = ['writing_translation', 'easy', 'mcq', 'Which sentence uses correct capitalization?', ['a' => 'i live in Hyderabad.', 'b' => 'I live in Hyderabad.', 'c' => 'I Live In hyderabad.', 'd' => 'i Live in Hyderabad.'], 'b', null, 1];
    $q[] = ['writing_translation', 'easy', 'mcq', 'What is proofreading?', ['a' => 'Checking writing for errors', 'b' => 'Writing code', 'c' => 'Designing a logo', 'd' => 'Translating a video'], 'a', null, 1];
    $q[] = ['writing_translation', 'easy', 'mcq', 'What is a paragraph?', ['a' => 'A group of related sentences', 'b' => 'A single word', 'c' => 'A punctuation mark', 'd' => 'A title only'], 'a', null, 1];
    $q[] = ['writing_translation', 'easy', 'mcq', 'What is plagiarism?', ['a' => 'Using someone else\'s work/ideas without proper attribution', 'b' => 'Correcting grammar', 'c' => 'Writing an original article', 'd' => 'Adding a citation'], 'a', null, 1];
    $q[] = ['writing_translation', 'easy', 'mcq', 'What is tone in writing?', ['a' => 'The attitude or feeling conveyed by the writing', 'b' => 'The font size', 'c' => 'The word count', 'd' => 'The page number'], 'a', null, 1];
    $q[] = ['writing_translation', 'easy', 'mcq', 'What is a noun?', ['a' => 'A person, place, thing, or idea', 'b' => 'An action word only', 'c' => 'A punctuation mark', 'd' => 'A sentence ending'], 'a', null, 1];
    $q[] = ['writing_translation', 'easy', 'mcq', 'What is a verb?', ['a' => 'A word that expresses an action or state', 'b' => 'A place name', 'c' => 'A punctuation mark', 'd' => 'A paragraph'], 'a', null, 1];
    $q[] = ['writing_translation', 'easy', 'mcq', 'What is translation?', ['a' => 'Converting content from one language to another', 'b' => 'Changing font size', 'c' => 'Summarizing only', 'd' => 'Writing a headline'], 'a', null, 1];
    $q[] = ['writing_translation', 'easy', 'mcq', 'What is localization?', ['a' => 'Adapting content for a specific language/culture/market', 'b' => 'Removing all text', 'c' => 'Making content longer', 'd' => 'Changing only the font'], 'a', null, 1];
    $q[] = ['writing_translation', 'easy', 'mcq', 'What is a headline?', ['a' => 'A title designed to introduce or attract attention to content', 'b' => 'A paragraph ending', 'c' => 'A footnote', 'd' => 'A translation tool'], 'a', null, 1];
    $q[] = ['writing_translation', 'easy', 'mcq', 'What is active voice?', ['a' => 'The subject performs the action', 'b' => 'The object always comes first', 'c' => 'Every sentence is a question', 'd' => 'A sentence with no verb'], 'a', null, 1];
    $q[] = ['writing_translation', 'easy', 'mcq', 'Why is clarity important in writing?', ['a' => 'It helps readers understand the message easily', 'b' => 'It makes every sentence longer', 'c' => 'It removes punctuation', 'd' => 'It prevents editing'], 'a', null, 1];

    // ── Business & Finance ──
    $q[] = ['business_finance', 'easy', 'mcq', 'What is revenue?', ['a' => 'Income generated from sales/business activity', 'b' => 'Total expenses', 'c' => 'A loan', 'd' => 'Employee attendance'], 'a', null, 1];
    $q[] = ['business_finance', 'easy', 'mcq', 'What is a budget?', ['a' => 'A plan for expected income and expenses', 'b' => 'A tax only', 'c' => 'A bank account', 'd' => 'A sales receipt'], 'a', null, 1];
    $q[] = ['business_finance', 'easy', 'mcq', 'What is profit?', ['a' => 'Revenue minus costs/expenses', 'b' => 'Revenue plus expenses', 'c' => 'Only sales', 'd' => 'Money borrowed'], 'a', null, 1];
    $q[] = ['business_finance', 'easy', 'mcq', 'What is a startup?', ['a' => 'A newly founded company, often aiming to grow', 'b' => 'A government office', 'c' => 'A bank account', 'd' => 'A finished product'], 'a', null, 1];
    $q[] = ['business_finance', 'easy', 'mcq', 'What does equity represent in a company?', ['a' => 'Ownership interest', 'b' => 'A monthly bill', 'c' => 'A tax', 'd' => 'A loan'], 'a', null, 1];
    $q[] = ['business_finance', 'easy', 'mcq', 'What is a customer?', ['a' => 'A person or organization that buys or uses a product/service', 'b' => 'An employee only', 'c' => 'A competitor', 'd' => 'An investor only'], 'a', null, 1];
    $q[] = ['business_finance', 'easy', 'mcq', 'What is a business expense?', ['a' => 'Money spent to operate a business', 'b' => 'Money received from sales', 'c' => 'Company ownership', 'd' => 'A customer review'], 'a', null, 1];
    $q[] = ['business_finance', 'easy', 'mcq', 'What is a sale?', ['a' => 'A transaction in which a product/service is provided for payment', 'b' => 'A business loan', 'c' => 'A company meeting', 'd' => 'A salary'], 'a', null, 1];
    $q[] = ['business_finance', 'easy', 'mcq', 'What does ROI stand for?', ['a' => 'Return on Investment', 'b' => 'Rate of Income', 'c' => 'Revenue on Invoice', 'd' => 'Return on Interest'], 'a', null, 1];
    $q[] = ['business_finance', 'easy', 'mcq', 'What is break-even?', ['a' => 'The point where revenue equals total costs', 'b' => 'The point of maximum profit', 'c' => 'The first sale', 'd' => 'A company shutdown'], 'a', null, 1];
    $q[] = ['business_finance', 'easy', 'mcq', 'What is an investor?', ['a' => 'Someone who provides money/capital expecting a return', 'b' => 'A customer support agent', 'c' => 'A product designer', 'd' => 'A supplier only'], 'a', null, 1];
    $q[] = ['business_finance', 'easy', 'mcq', 'What is a market?', ['a' => 'The group of potential customers and/or the environment where buying and selling occurs', 'b' => 'Only a physical shop', 'c' => 'A company bank account', 'd' => 'A salary list'], 'a', null, 1];
    $q[] = ['business_finance', 'easy', 'mcq', 'What is a business model?', ['a' => 'How a business creates, delivers, and earns value', 'b' => 'A company logo', 'c' => 'A tax receipt', 'd' => 'A job description'], 'a', null, 1];
    $q[] = ['business_finance', 'easy', 'mcq', 'What is a commission?', ['a' => 'A percentage or fee earned from a transaction or service', 'b' => 'A fixed salary only', 'c' => 'A loan', 'd' => 'A tax return'], 'a', null, 1];
    $q[] = ['business_finance', 'easy', 'mcq', 'What is cash flow?', ['a' => 'Money moving into and out of a business', 'b' => 'Company ownership', 'c' => 'A marketing slogan', 'd' => 'A product feature'], 'a', null, 1];

    // ── Digital Marketing ──
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What does SEO stand for?', ['a' => 'Search Engine Optimization', 'b' => 'Social Engagement Output', 'c' => 'Search Email Operation', 'd' => 'Site Editing Option'], 'a', null, 1];
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What does CTR stand for?', ['a' => 'Click Through Rate', 'b' => 'Customer Traffic Report', 'c' => 'Cost To Reach', 'd' => 'Click Target Ratio'], 'a', null, 1];
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What does CPC mean?', ['a' => 'Cost Per Click', 'b' => 'Cost Per Customer', 'c' => 'Content Per Campaign', 'd' => 'Click Per Conversion'], 'a', null, 1];
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What is an impression?', ['a' => 'An instance of an ad/content being displayed', 'b' => 'A completed purchase', 'c' => 'A comment', 'd' => 'A password'], 'a', null, 1];
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What is organic reach?', ['a' => 'People reached without paid promotion', 'b' => 'People reached only through ads', 'c' => 'Total ad spend', 'd' => 'Number of employees'], 'a', null, 1];
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What is a hashtag used for?', ['a' => 'Helping categorize and discover social media content', 'b' => 'Sending an email', 'c' => 'Editing a photo', 'd' => 'Creating a website'], 'a', null, 1];
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What is content marketing?', ['a' => 'Creating and sharing useful content to attract and engage an audience', 'b' => 'Calling customers only', 'c' => 'Buying office equipment', 'd' => 'Writing code'], 'a', null, 1];
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What is social media marketing?', ['a' => 'Promoting a brand/product through social platforms', 'b' => 'Selling only in stores', 'c' => 'Managing payroll', 'd' => 'Designing databases'], 'a', null, 1];
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What is a target audience?', ['a' => 'The group of people a campaign is intended to reach', 'b' => 'The marketing team', 'c' => 'A competitor', 'd' => 'A website server'], 'a', null, 1];
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What is a call to action (CTA)?', ['a' => 'A prompt encouraging the audience to take an action', 'b' => 'A company logo', 'c' => 'A payment receipt', 'd' => 'A type of hashtag'], 'a', null, 1];
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What is an ad campaign?', ['a' => 'A planned set of promotional activities around a goal', 'b' => 'A customer complaint', 'c' => 'A software bug', 'd' => 'A financial statement'], 'a', null, 1];
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What is engagement?', ['a' => 'Interactions such as likes, comments, shares, saves, or replies', 'b' => 'Only impressions', 'c' => 'Only purchases', 'd' => 'Only followers'], 'a', null, 1];
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What is a landing page?', ['a' => 'A page designed around a specific marketing action or goal', 'b' => 'A database table', 'c' => 'A company invoice', 'd' => 'A video editor'], 'a', null, 1];
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What is a UTM parameter used for?', ['a' => 'Tracking where website traffic comes from', 'b' => 'Encrypting a password', 'c' => 'Compressing images', 'd' => 'Blocking all users'], 'a', null, 1];
    $q[] = ['digital_marketing', 'easy', 'mcq', 'What is conversion in digital marketing?', ['a' => 'When a user completes a desired action, such as signing up or buying', 'b' => 'When an ad is displayed', 'c' => 'When a hashtag is created', 'd' => 'When a page loads'], 'a', null, 1];

    // ── Data Analytics ──
    $q[] = ['data_analytics', 'easy', 'mcq', 'What is a dataset?', ['a' => 'A collection of data', 'b' => 'A single chart', 'c' => 'A programming language', 'd' => 'A camera setting'], 'a', null, 1];
    $q[] = ['data_analytics', 'easy', 'mcq', 'What does CSV stand for?', ['a' => 'Comma Separated Values', 'b' => 'Central Statistical View', 'c' => 'Calculated Sheet Values', 'd' => 'Column Sorted Variables'], 'a', null, 1];
    $q[] = ['data_analytics', 'easy', 'mcq', 'What is a row in a spreadsheet?', ['a' => 'A horizontal record/entry of data', 'b' => 'A chart', 'c' => 'A formula only', 'd' => 'A column heading'], 'a', null, 1];
    $q[] = ['data_analytics', 'easy', 'mcq', 'What is a column?', ['a' => 'A vertical set of related values', 'b' => 'A chart', 'c' => 'A single formula', 'd' => 'A file name'], 'a', null, 1];
    $q[] = ['data_analytics', 'easy', 'mcq', 'What is the mean?', ['a' => 'The average of a set of numbers', 'b' => 'The middle value only', 'c' => 'The most frequent value', 'd' => 'The highest value'], 'a', null, 1];
    $q[] = ['data_analytics', 'easy', 'mcq', 'What is the median?', ['a' => 'The middle value when data is ordered', 'b' => 'The average', 'c' => 'The most frequent value', 'd' => 'The total'], 'a', null, 1];
    $q[] = ['data_analytics', 'easy', 'mcq', 'What is the mode?', ['a' => 'The value that appears most often', 'b' => 'The average', 'c' => 'The middle value', 'd' => 'The largest value'], 'a', null, 1];
    $q[] = ['data_analytics', 'easy', 'mcq', 'What is a bar chart useful for?', ['a' => 'Comparing values across categories', 'b' => 'Showing only text', 'c' => 'Writing SQL', 'd' => 'Storing passwords'], 'a', null, 1];
    $q[] = ['data_analytics', 'easy', 'mcq', 'What is a line chart commonly used to show?', ['a' => 'Trends over time', 'b' => 'Only one number', 'c' => 'Database passwords', 'd' => 'File names'], 'a', null, 1];
    $q[] = ['data_analytics', 'easy', 'mcq', 'What is a pivot table used for?', ['a' => 'Summarizing and analyzing data', 'b' => 'Editing photos', 'c' => 'Writing emails', 'd' => 'Creating passwords'], 'a', null, 1];
    $q[] = ['data_analytics', 'easy', 'mcq', 'What is a null/missing value?', ['a' => 'A value that is absent or unknown', 'b' => 'Always zero', 'c' => 'Always negative', 'd' => 'A chart type'], 'a', null, 1];
    $q[] = ['data_analytics', 'easy', 'mcq', 'What is data cleaning?', ['a' => 'Fixing, organizing, and preparing data for analysis', 'b' => 'Deleting all data', 'c' => 'Making a presentation only', 'd' => 'Changing a camera setting'], 'a', null, 1];
    $q[] = ['data_analytics', 'easy', 'mcq', 'What is an Excel formula?', ['a' => 'An expression used to calculate a result in a spreadsheet', 'b' => 'A chart title', 'c' => 'A file format', 'd' => 'A database password'], 'a', null, 1];
    $q[] = ['data_analytics', 'easy', 'mcq', 'What does SUM usually do in a spreadsheet?', ['a' => 'Adds numbers together', 'b' => 'Finds text', 'c' => 'Deletes rows', 'd' => 'Creates a chart'], 'a', null, 1];
    $q[] = ['data_analytics', 'easy', 'mcq', 'Why visualize data?', ['a' => 'To make patterns and comparisons easier to understand', 'b' => 'To hide information', 'c' => 'To increase file size', 'd' => 'To replace all analysis'], 'a', null, 1];

    // ── Video & Animation ──
    $q[] = ['video_animation', 'easy', 'mcq', 'What does FPS stand for?', ['a' => 'Frames Per Second', 'b' => 'File Processing Speed', 'c' => 'Final Production Stage', 'd' => 'Frame Picture Size'], 'a', null, 1];
    $q[] = ['video_animation', 'easy', 'mcq', 'What is aspect ratio?', ['a' => 'The relationship between video width and height', 'b' => 'Video file size', 'c' => 'Audio volume', 'd' => 'Camera battery level'], 'a', null, 1];
    $q[] = ['video_animation', 'easy', 'mcq', 'What is editing?', ['a' => 'Arranging and trimming footage into a sequence', 'b' => 'Only recording audio', 'c' => 'Uploading a file', 'd' => 'Buying a camera'], 'a', null, 1];
    $q[] = ['video_animation', 'easy', 'mcq', 'What is a timeline in video editing?', ['a' => 'The area where clips are arranged in sequence', 'b' => 'A camera setting', 'c' => 'A file format', 'd' => 'A microphone'], 'a', null, 1];
    $q[] = ['video_animation', 'easy', 'mcq', 'What is a transition?', ['a' => 'An effect or change from one shot/scene to another', 'b' => 'A camera lens', 'c' => 'A sound recorder', 'd' => 'A storage device'], 'a', null, 1];
    $q[] = ['video_animation', 'easy', 'mcq', 'What is resolution?', ['a' => 'The number of pixels that make up an image/video', 'b' => 'The video duration', 'c' => 'The frame rate', 'd' => 'The audio volume'], 'a', null, 1];
    $q[] = ['video_animation', 'easy', 'mcq', 'What is B-roll?', ['a' => 'Supplementary footage used to support the main footage', 'b' => 'The final export', 'c' => 'A broken camera', 'd' => 'A subtitle file'], 'a', null, 1];
    $q[] = ['video_animation', 'easy', 'mcq', 'What does render mean?', ['a' => 'Processing a project to produce an output video', 'b' => 'Recording a scene', 'c' => 'Deleting clips', 'd' => 'Writing a script'], 'a', null, 1];
    $q[] = ['video_animation', 'easy', 'mcq', 'What is audio sync?', ['a' => 'Matching audio timing with the video', 'b' => 'Adding a filter', 'c' => 'Changing resolution', 'd' => 'Removing all sound'], 'a', null, 1];
    $q[] = ['video_animation', 'easy', 'mcq', 'What is a cut?', ['a' => 'A change from one shot/clip to another', 'b' => 'A camera brand', 'c' => 'A file extension', 'd' => 'A lighting setup'], 'a', null, 1];
    $q[] = ['video_animation', 'easy', 'mcq', 'What is a keyframe used for?', ['a' => 'Marking a value at a point in an animation', 'b' => 'Saving a video file', 'c' => 'Recording audio', 'd' => 'Changing a camera lens'], 'a', null, 1];
    $q[] = ['video_animation', 'easy', 'mcq', 'What is a storyboard?', ['a' => 'A visual plan of scenes/shots before production', 'b' => 'A final export file', 'c' => 'A microphone setting', 'd' => 'A color profile'], 'a', null, 1];
    $q[] = ['video_animation', 'easy', 'mcq', 'What are motion graphics?', ['a' => 'Animated graphic elements such as titles, shapes, and logos', 'b' => 'Only raw camera footage', 'c' => 'Database charts', 'd' => 'Audio recordings'], 'a', null, 1];
    $q[] = ['video_animation', 'easy', 'mcq', 'What is slow motion?', ['a' => 'Making movement appear slower by changing playback/frame timing', 'b' => 'Increasing audio volume', 'c' => 'Cropping a video', 'd' => 'Adding subtitles'], 'a', null, 1];
    $q[] = ['video_animation', 'easy', 'mcq', 'What is MP4?', ['a' => 'A common video container/file format', 'b' => 'A camera lens', 'c' => 'An audio microphone', 'd' => 'An animation principle'], 'a', null, 1];

    // ── Photography ──
    $q[] = ['photography', 'easy', 'mcq', 'What does ISO control in a camera?', ['a' => 'Sensor sensitivity to light', 'b' => 'Lens focal length', 'c' => 'Shutter shape', 'd' => 'White balance only'], 'a', null, 1];
    $q[] = ['photography', 'easy', 'mcq', 'What does aperture control?', ['a' => 'The size of the lens opening and depth of field', 'b' => 'The camera battery', 'c' => 'The memory card', 'd' => 'The photo file name'], 'a', null, 1];
    $q[] = ['photography', 'easy', 'mcq', 'What is shutter speed?', ['a' => 'How long the sensor is exposed to light', 'b' => 'The lens focal length', 'c' => 'The image size', 'd' => 'The camera weight'], 'a', null, 1];
    $q[] = ['photography', 'easy', 'mcq', 'What is exposure?', ['a' => 'The overall brightness/darkness of an image', 'b' => 'The lens brand', 'c' => 'The battery level', 'd' => 'The file type'], 'a', null, 1];
    $q[] = ['photography', 'easy', 'mcq', 'What is white balance used for?', ['a' => 'Correcting unwanted color casts from lighting', 'b' => 'Making an image larger', 'c' => 'Increasing battery life', 'd' => 'Changing the lens'], 'a', null, 1];
    $q[] = ['photography', 'easy', 'mcq', 'What is golden hour?', ['a' => 'The soft, warm light around sunrise or sunset', 'b' => 'Midday only', 'c' => 'A camera setting', 'd' => 'An editing filter'], 'a', null, 1];
    $q[] = ['photography', 'easy', 'mcq', 'What is bokeh?', ['a' => 'The aesthetic appearance of blurred out-of-focus areas', 'b' => 'A camera battery', 'c' => 'A flash mode', 'd' => 'A lens cap'], 'a', null, 1];
    $q[] = ['photography', 'easy', 'mcq', 'What is macro photography?', ['a' => 'Close-up photography of small subjects', 'b' => 'Wide landscape photography only', 'c' => 'Sports photography only', 'd' => 'Night photography only'], 'a', null, 1];
    $q[] = ['photography', 'easy', 'mcq', 'What is framing?', ['a' => 'How a subject is positioned within the shot', 'b' => 'Adding a physical frame after printing', 'c' => 'Changing ISO', 'd' => 'Selecting a camera brand'], 'a', null, 1];
    $q[] = ['photography', 'easy', 'mcq', 'What is composition?', ['a' => 'How visual elements are arranged within a photograph', 'b' => 'The file size', 'c' => 'The camera battery', 'd' => 'The shutter button'], 'a', null, 1];
    $q[] = ['photography', 'easy', 'mcq', 'What is focus?', ['a' => 'Making the intended subject appear sharp', 'b' => 'Changing the photo format', 'c' => 'Increasing ISO automatically', 'd' => 'Adding a border'], 'a', null, 1];
    $q[] = ['photography', 'easy', 'mcq', 'What is a DSLR?', ['a' => 'A Digital Single-Lens Reflex camera', 'b' => 'A photo editing app', 'c' => 'A smartphone filter', 'd' => 'A type of memory card'], 'a', null, 1];
    $q[] = ['photography', 'easy', 'mcq', 'What is a wide-angle lens generally useful for?', ['a' => 'Capturing a wider field of view', 'b' => 'Extreme close-up only', 'c' => 'Increasing battery life', 'd' => 'Recording audio'], 'a', null, 1];
    $q[] = ['photography', 'easy', 'mcq', 'What is a portrait photograph mainly focused on?', ['a' => 'A person or people', 'b' => 'Only landscapes', 'c' => 'A spreadsheet', 'd' => 'A video timeline'], 'a', null, 1];
    $q[] = ['photography', 'easy', 'mcq', 'What does a tripod help with?', ['a' => 'Keeping the camera stable', 'b' => 'Changing ISO automatically', 'c' => 'Editing colors', 'd' => 'Increasing storage'], 'a', null, 1];

    $task = static function (string $domain, string $prompt) {
        return [$domain, 'task', 'task', $prompt, null, null, null, 0];
    };

    $q[] = $task('python', 'Write a tiny Python program that stores your name in a variable and prints: Hello, <name>.');
    $q[] = $task('javascript', 'Write one JavaScript line that stores the number 10 in a variable named score and prints score using console.log().');
    $q[] = $task('html_css', 'Create a very simple HTML page containing one heading that says \'My First Webpage\' and one paragraph that says \'Hello Peaklyy\'.');
    $q[] = $task('java', 'Write a tiny Java program that prints \'Hello Peaklyy\' to the console.');
    $q[] = $task('ui_design', 'Create or sketch a very simple mobile gig card containing: gig title, company name, reward, and one Apply button.');
    $q[] = $task('writing_translation', 'Write a short 2-sentence introduction for a student who is applying for their first gig.');
    $q[] = $task('business_finance', 'A gig pays ₹1,000. Write down the student\'s expected income and one simple business expense you might consider.');
    $q[] = $task('digital_marketing', 'Write one short Instagram caption (1–2 sentences) promoting a new Peaklyy student gig.');
    $q[] = $task('data_analytics', 'Given the numbers 10, 20, 30, calculate the average and write the answer.');
    $q[] = $task('video_animation', 'Create a simple 3-shot plan for a 10-second video introducing Peaklyy. Write one line describing each shot.');
    $q[] = $task('photography', 'Take or select one photo of a simple object and write one sentence explaining why you chose that framing.');

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
