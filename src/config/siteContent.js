// Central registry of every admin-editable piece of public site content.
//
// One entry per SiteSetting key, grouped into independently saved FORMS and
// presented under TABS in Admin > Site Content. The registry is the single
// source of truth for: default (current production) copy, validation rules,
// admin form rendering and the nested `cms` object that views read.
//
// Rules this file enforces by construction:
//   - values are plain text only (never HTML / EJS / CSS / JS)
//   - link targets are chosen from a fixed list of application-controlled
//     routes/anchors (never an admin-typed URL)
//   - images are referenced by an opaque "site/<uuid>.<ext>" path only
//   - a blank saved value always means "use the default"

const PRIVACY_BODY = `## Overview
This Privacy Policy explains what information this website collects and how it is used. By creating an account or using the website you acknowledge this policy.

## Information we collect
- Account details you provide, such as your name and email address.
- Learning activity, such as course enrollments, lesson progress and certificates.
- Messages you send through the contact form and, if you subscribe, your email address for course updates.
- Order details when you purchase a course. Card and bank details are handled by the payment provider and are not stored on this website.
- Technical information, such as cookies that keep you signed in and protect forms.

## How we use information
- To provide access to your courses and record your progress.
- To respond to enquiries and send account or course messages.
- To keep the website secure and working properly.

## Cookies
We use essential cookies to keep you signed in and to protect forms against misuse.

## Sharing
Information is shared only with service providers needed to run the platform, such as hosting, email delivery and payment processing, or where required by law.

## Your choices
You can contact us to ask about, correct or delete your account information using the contact details shown on this website.

## Updates
This policy may be updated from time to time. The date of the latest update is shown on this page.`;

const TERMS_BODY = `## Using this website
By creating an account or using this website you agree to these terms.

## Your account
You are responsible for keeping your login details confidential and for activity under your account. Please provide accurate information when you register.

## Course access
Access to a course is granted to the enrolled student for personal learning only. Accounts and course access may not be shared or transferred.

## Course content
Course videos, materials and certificates belong to the institute or its instructors. You may not copy, record, download, redistribute or resell them without written permission.

## Acceptable use
Do not attempt to gain unauthorised access to the website, interfere with its operation, or submit false progress or completion information.

## Certificates
Certificates are issued to students who complete all lessons of a course, as recorded by the platform.

## Payments and enrollment
Course prices and enrollment arrangements are shown on each course page. For questions about payments or enrollment, please contact us.

## Availability and changes
We aim to keep the website available but do not guarantee uninterrupted access. Courses, these terms and the website may be updated from time to time.

## Contact
Questions about these terms can be sent through the contact page.`;

// Application-controlled link targets. Admins pick from this list; they can
// never type a URL. Order matters only for the dropdown.
const LINK_TARGETS = [
  { value: '#courses', label: 'Homepage - Featured courses section' },
  { value: '#categories', label: 'Homepage - Categories section' },
  { value: '#about', label: 'Homepage - Why ICDS / About section' },
  { value: '#process', label: 'Homepage - Learning process section' },
  { value: '#instructors', label: 'Homepage - Instructors section' },
  { value: '#testimonials', label: 'Homepage - Reviews section' },
  { value: '#faq', label: 'Homepage - FAQ section' },
  { value: '/courses', label: 'Courses page' },
  { value: '/contact', label: 'Contact page' },
  { value: '/signup', label: 'Sign up page' },
  { value: '/login', label: 'Login page' },
];
const SAFE_CTA_TARGETS = LINK_TARGETS.map((t) => t.value);

const SHORT = 150;
const DESC = 600;
const LABEL = 60;

// --- field constructors -----------------------------------------------------
const text = (key, label, def, max = SHORT, extra = {}) => ({ key, label, type: 'text', def, max, ...extra });
const area = (key, label, def, max = DESC, extra = {}) => ({ key, label, type: 'textarea', def, max, ...extra });
const label = (key, lbl, def, extra = {}) => text(key, lbl, def, LABEL, extra);
const bool = (key, lbl, def = true, extra = {}) => ({ key, label: lbl, type: 'bool', def: def ? 'true' : 'false', ...extra });
const target = (key, lbl, def) => ({ key, label: lbl, type: 'target', def });
const image = (key, lbl, extra = {}) => ({ key, label: lbl, type: 'image', def: '', ...extra });
const seoTitle = (key, lbl = 'SEO title') => text(key, lbl, '', 70, { help: 'Shown in the browser tab and search results. Up to 70 characters. Leave blank to use the automatic title.' });
const seoDesc = (key, lbl = 'SEO description') => area(key, lbl, '', 170, { rows: 3, help: 'Search-result summary. Up to 170 characters. Leave blank to use the automatic description.' });

// A form's `fields` is an ordered list; `{ heading }` entries render as
// sub-headings inside the form.
const sub = (heading) => ({ heading });

const TABS = [
  {
    id: 'brand',
    title: 'Brand & Global',
    icon: 'bi-building',
    forms: [
      {
        id: 'identity',
        title: 'Institute identity',
        description: 'Name, logo and tagline used across the whole site. Blank fields use the server defaults shown as placeholders.',
        fields: [
          text('site.name', 'Institute full name', '', 120, { blankClears: true, envKey: 'name' }),
          text('brand.shortName', 'Short name', '', 40, { help: 'Used where space is tight, e.g. the installed-app name. Leave blank to derive it automatically.' }),
          text('brand.tagline', 'Tagline (top bar)', 'Learn. Practice. Grow. Build Your Professional Future.'),
          text('brand.copyrightName', 'Copyright holder name', '', 120, { blankClears: true, help: 'Shown in the footer copyright line. Leave blank to use the institute name.' }),
          image('brand.logoPath', 'Logo', { help: 'Replaces the default mortarboard icon in the header. JPG, PNG or WebP.' }),
          image('brand.faviconPath', 'Favicon', { help: 'Square image (PNG recommended). Replaces the default browser-tab icon.' }),
        ],
      },
      {
        id: 'contact',
        title: 'Contact details',
        description: 'Used in the header strip, footer, contact page and support pop-up. Blank fields use the server defaults.',
        fields: [
          { key: 'contact.email', label: 'Primary contact email', type: 'email', def: '', blankClears: true, envKey: 'email' },
          { key: 'contact.supportEmail', label: 'Support email', type: 'email', def: '', blankClears: true, envKey: 'supportEmail', help: 'Leave blank to use the primary contact email.' },
          { key: 'contact.phone', label: 'Phone', type: 'phone', def: '', blankClears: true, envKey: 'phone' },
          area('contact.address', 'Address', '', 300, { blankClears: true, rows: 2, envKey: 'address' }),
        ],
      },
      {
        id: 'seo',
        title: 'Default SEO',
        description: 'Used for pages that do not have their own SEO text.',
        fields: [
          seoTitle('seo.defaultTitle', 'Default SEO title'),
          seoDesc('seo.defaultDescription', 'Default SEO description'),
        ],
      },
    ],
  },
  {
    id: 'header',
    title: 'Header',
    icon: 'bi-layout-text-window',
    forms: [
      {
        id: 'strip',
        title: 'Top announcement strip',
        fields: [
          bool('header.stripEnabled', 'Show the top strip'),
          text('header.stripText', 'Strip text', '', SHORT, { help: 'Leave blank to show the tagline from Brand & Global.' }),
          bool('header.stripShowPhone', 'Show phone number in the strip'),
          bool('header.stripShowEmail', 'Show email in the strip'),
        ],
      },
      {
        id: 'navigation',
        title: 'Navigation',
        description: 'Links and routes are fixed by the application; you can rename them and show or hide each one. The Courses dropdown always lists your active categories.',
        fields: [
          sub('Home'),
          bool('nav.showHome', 'Show', true),
          label('nav.homeLabel', 'Label', 'Home'),
          sub('Courses'),
          bool('nav.showCourses', 'Show', true),
          label('nav.coursesLabel', 'Label', 'Courses'),
          label('nav.allCoursesLabel', 'Dropdown "all courses" label', 'All Courses'),
          sub('About'),
          bool('nav.showAbout', 'Show', true),
          label('nav.aboutLabel', 'Label', 'About'),
          sub('Instructors'),
          bool('nav.showInstructors', 'Show', true),
          label('nav.instructorsLabel', 'Label', 'Instructors'),
          sub('Reviews'),
          bool('nav.showReviews', 'Show', true),
          label('nav.reviewsLabel', 'Label', 'Reviews'),
          sub('FAQ'),
          bool('nav.showFaq', 'Show', true),
          label('nav.faqLabel', 'Label', 'FAQ'),
          sub('Contact'),
          bool('nav.showContact', 'Show', false),
          label('nav.contactLabel', 'Label', 'Contact'),
        ],
      },
      {
        id: 'account',
        title: 'Account buttons',
        fields: [
          label('nav.loginLabel', 'Login button', 'Login'),
          label('nav.signupLabel', 'Sign Up button', 'Sign Up'),
          label('nav.ordersLabel', 'My Orders button (signed-in students)', 'My Orders'),
          label('nav.logoutLabel', 'Logout button', 'Logout'),
        ],
      },
    ],
  },
  {
    id: 'home',
    title: 'Homepage',
    icon: 'bi-house',
    forms: [
      {
        id: 'hero',
        title: 'Hero',
        fields: [
          bool('hero.enabled', 'Show the hero section'),
          text('hero.eyebrow', 'Eyebrow', 'Professional Online Learning'),
          text('hero.heading', 'Heading', 'Master the skills that'),
          text('hero.highlight', 'Highlighted heading text', 'shape confidence.', 80, { help: 'Shown in the accent colour after the heading.' }),
          area('hero.description', 'Description', 'Learn professional cosmetology, aesthetics, dental sciences and beauty skills through expert-led video courses designed for students, professionals and aspiring practitioners.'),
          text('hero.searchPlaceholder', 'Search box placeholder', 'What do you want to learn today?'),
          label('hero.searchButton', 'Search button label', 'Search'),
          label('hero.primaryLabel', 'Primary button label', 'Explore Courses'),
          target('hero.primaryTarget', 'Primary button target', '#courses'),
          label('hero.secondaryLabel', 'Secondary button label', 'How It Works'),
          target('hero.secondaryTarget', 'Secondary button target', '#process'),
          image('hero.imagePath', 'Hero image', { help: 'Replaces the default hero photo. Landscape or square works best.' }),
          text('hero.imageAlt', 'Hero image description (alt text)', 'Professional cosmetology and beauty training at ICDS'),
          sub('Floating badges on the hero image'),
          bool('hero.showBadges', 'Show the two badges'),
          label('hero.badge1Title', 'Badge 1 title', 'Video Lessons'),
          label('hero.badge1Text', 'Badge 1 text', 'Learn at your own pace'),
          label('hero.badge2Title', 'Badge 2 title', 'Course Certificate'),
          label('hero.badge2Text', 'Badge 2 text', 'Complete & earn'),
          sub('Statistics strip (numbers always come from real data)'),
          bool('hero.showStats', 'Show the statistics strip'),
          label('hero.statCoursesLabel', 'Courses label', 'Professional Courses'),
          label('hero.statStudentsLabel', 'Students label', 'Students Learning'),
          label('hero.statInstructorsLabel', 'Instructors label', 'Expert Instructors'),
          label('hero.statRatingLabel', 'Rating label', 'Student Rating'),
        ],
      },
      {
        id: 'categories',
        title: 'Categories section',
        description: 'The category cards come from Admin > Categories.',
        fields: [
          bool('categories.enabled', 'Show this section'),
          text('categories.eyebrow', 'Eyebrow', 'Learn by Category'),
          text('categories.heading', 'Heading', 'Choose your area of expertise'),
          area('categories.description', 'Description', 'Explore structured courses across beauty, aesthetics, cosmetology and dental sciences.'),
          text('categories.emptyText', 'Empty-state text', 'Categories will appear here once they are added.'),
        ],
      },
      {
        id: 'featured',
        title: 'Featured courses section',
        description: 'Course cards are your real courses marked "Featured" in Admin > Courses.',
        fields: [
          bool('featured.enabled', 'Show this section'),
          text('featured.eyebrow', 'Eyebrow', 'Popular Courses'),
          text('featured.heading', 'Heading', 'Learn from courses students love'),
          area('featured.description', 'Description', 'Practical, structured and professionally designed video courses created to help you develop real-world skills.'),
          label('featured.ctaLabel', 'Button label', 'View All Courses'),
          text('featured.emptyText', 'Empty-state text', 'No featured courses are published yet. Check back soon.'),
        ],
      },
      {
        id: 'why',
        title: 'Why ICDS / About section',
        fields: [
          bool('why.enabled', 'Show this section'),
          text('why.eyebrow', 'Eyebrow', 'Why ICDS'),
          text('why.heading', 'Heading', 'Education that goes beyond watching videos.'),
          area('why.description', 'Description', 'Our online learning experience combines structured lessons, practical demonstrations and expert guidance to help students turn knowledge into professional skills.'),
          label('why.ctaLabel', 'Button label', 'Start Learning'),
          target('why.ctaTarget', 'CTA target', '#courses'),
          image('why.imagePath', 'Section image', { help: 'Leave empty to use the default image.' }),
          text('why.imageAlt', 'Image description (alt text)', 'Students in a professional cosmetology training environment'),
          sub('Feature 1'),
          text('why.feature1Title', 'Title', 'Expert-led video lessons'),
          area('why.feature1Desc', 'Description', 'Learn from experienced educators and industry professionals.', DESC, { rows: 2 }),
          sub('Feature 2'),
          text('why.feature2Title', 'Title', 'Learn at your own pace'),
          area('why.feature2Desc', 'Description', 'Access your enrolled courses whenever and wherever you want.', DESC, { rows: 2 }),
          sub('Feature 3'),
          text('why.feature3Title', 'Title', 'Practical demonstrations'),
          area('why.feature3Desc', 'Description', 'Watch real-world techniques explained step-by-step.', DESC, { rows: 2 }),
          sub('Feature 4'),
          text('why.feature4Title', 'Title', 'Certificates of completion'),
          area('why.feature4Desc', 'Description', 'Complete eligible courses and receive your certificate.', DESC, { rows: 2 }),
        ],
      },
      {
        id: 'process',
        title: 'Learning process section',
        fields: [
          bool('process.enabled', 'Show this section'),
          text('process.eyebrow', 'Eyebrow', 'Simple Learning Process'),
          text('process.heading', 'Heading', 'Start learning in four simple steps'),
          area('process.description', 'Description', 'From selecting your course to completing your lessons, everything is designed to be simple and convenient.'),
          sub('Step 1'),
          text('process.step1Number', 'Number', '01', 6),
          text('process.step1Title', 'Title', 'Choose a Course'),
          area('process.step1Desc', 'Description', 'Browse categories and select the course that matches your learning goals.', DESC, { rows: 2 }),
          sub('Step 2'),
          text('process.step2Number', 'Number', '02', 6),
          text('process.step2Title', 'Title', 'Create Account'),
          area('process.step2Desc', 'Description', 'Register your student account using your email address.', DESC, { rows: 2 }),
          sub('Step 3'),
          text('process.step3Number', 'Number', '03', 6),
          text('process.step3Title', 'Title', 'Request Enrollment'),
          area('process.step3Desc', 'Description', "Submit your enrollment request for the course you'd like to join.", DESC, { rows: 2 }),
          sub('Step 4'),
          text('process.step4Number', 'Number', '04', 6),
          text('process.step4Title', 'Title', 'Start Learning'),
          area('process.step4Desc', 'Description', 'Once your enrollment is confirmed, access your lessons from your student dashboard.', DESC, { rows: 2 }),
        ],
      },
      {
        id: 'instructors',
        title: 'Instructors section',
        description: 'Instructor cards come from Admin > Instructors.',
        fields: [
          bool('instructors.enabled', 'Show this section'),
          text('instructors.eyebrow', 'Eyebrow', 'Meet Your Mentors'),
          text('instructors.heading', 'Heading', 'Learn from experienced professionals'),
          area('instructors.description', 'Description', 'Our instructors bring practical knowledge and professional experience into every lesson.'),
          text('instructors.emptyStateText', 'Empty-state text', 'Instructor profiles are being updated.'),
        ],
      },
      {
        id: 'reviews',
        title: 'Reviews section',
        description: 'Reviews come from approved student reviews (see Admin > Reviews). The section stays hidden until at least one review is approved.',
        fields: [
          bool('reviews.enabled', 'Show this section'),
          text('reviews.eyebrow', 'Eyebrow', 'Student Stories'),
          text('reviews.heading', 'Heading', 'What our learners say'),
          area('reviews.description', 'Description', 'Real reviews from enrolled students.'),
        ],
      },
      {
        id: 'faq',
        title: 'FAQ section',
        description: 'Questions come from Admin > FAQs.',
        fields: [
          bool('faq.enabled', 'Show this section'),
          text('faq.eyebrow', 'Eyebrow', 'Frequently Asked Questions'),
          text('faq.heading', 'Heading', 'Everything you need to know'),
          area('faq.description', 'Description', '', DESC, { rows: 2, help: 'Optional. Leave blank to show no description.' }),
        ],
      },
      {
        id: 'newsletter',
        title: 'Newsletter section',
        fields: [
          bool('newsletter.enabled', 'Show this section'),
          text('newsletter.eyebrow', 'Eyebrow', 'Stay Updated'),
          text('newsletter.heading', 'Heading', 'Get new course updates in your inbox.'),
          area('newsletter.description', 'Description', 'Subscribe for new course announcements, educational resources, special offers and upcoming learning programs.'),
          text('newsletter.placeholder', 'Email box placeholder', 'Enter your email address'),
          label('newsletter.buttonLabel', 'Button label', 'Subscribe'),
          text('newsletter.successMessage', 'Success message', 'You are subscribed.'),
        ],
      },
      {
        id: 'seo',
        title: 'Homepage SEO',
        fields: [seoTitle('seo.home.title'), seoDesc('seo.home.description')],
      },
    ],
  },
  {
    id: 'courses',
    title: 'Courses Page',
    icon: 'bi-collection-play',
    forms: [
      {
        id: 'page',
        title: 'Courses listing page',
        description: 'Courses, categories, prices and status always come from the database.',
        fields: [
          text('courses.eyebrow', 'Eyebrow', 'Course Catalog'),
          text('courses.heading', 'Heading', 'All Courses'),
          area('courses.description', 'Description', "Browse every published course. Use search and filters to find exactly what you're looking for."),
          label('courses.searchLabel', 'Search label', 'Search'),
          text('courses.searchPlaceholder', 'Search placeholder', 'Search courses, instructors, categories...'),
          label('courses.categoryLabel', 'Category filter label', 'Category'),
          label('courses.allCategoriesLabel', '"All categories" option', 'All Categories'),
          label('courses.levelLabel', 'Level filter label', 'Level'),
          label('courses.allLevelsLabel', '"All levels" option', 'All Levels'),
          label('courses.submitLabel', 'Filter button label', 'Go'),
          label('courses.clearFiltersLabel', '"Clear filters" link', 'Clear filters'),
          text('courses.emptyHeading', 'Empty-state heading', 'No courses match your search'),
          text('courses.emptyText', 'Empty-state description', 'Try a different keyword, or clear your filters to see everything we offer.'),
          label('courses.emptyCta', 'Empty-state button', 'Browse All Courses'),
        ],
      },
      {
        id: 'seo',
        title: 'Courses page SEO',
        fields: [seoTitle('seo.courses.title'), seoDesc('seo.courses.description')],
      },
    ],
  },
  {
    id: 'course-detail',
    title: 'Course Detail',
    icon: 'bi-journal-text',
    forms: [
      {
        id: 'labels',
        title: 'Course page labels',
        description: 'Only generic labels live here. Each course\'s title, description, price, thumbnail and instructor come from the course itself. Course page SEO uses the course data.',
        fields: [
          label('course.backLabel', 'Back-to-courses link', '', { help: 'Leave blank to hide the link.' }),
          label('course.aboutHeading', '"About this course" heading', 'About this course'),
          label('course.curriculumHeading', 'Lessons section heading', 'Curriculum'),
          label('course.instructorHeading', 'Instructor section heading', '', { help: 'Optional. Leave blank to show no heading.' }),
          text('course.emptyLessons', 'Empty lesson list message', 'Lessons for this course are coming soon.'),
          label('course.enrolledCta', 'Button - already enrolled', 'Continue Learning'),
          label('course.requestCta', 'Button - request enrollment', 'Request Enrollment'),
          text('course.requestHelp', 'Help text under the request button', 'Submit a request and our team will reach out to complete your enrollment.'),
          label('course.requestedLabel', 'Button - request already sent', 'Enrollment Requested'),
          text('course.requestedHelp', 'Help text - request already sent', 'Our team will contact you to complete enrollment.'),
          label('course.freeCta', 'Button - free course', 'Enroll Free'),
          label('course.loginFreeCta', 'Button - sign in to enroll (free course)', 'Log In to Enroll'),
          label('course.loginRequestCta', 'Button - sign in to request (paid course)', 'Log In to Request Enrollment'),
          sub('Benefits list'),
          text('course.benefit1', 'Benefit 1', 'Access from your student dashboard', 100),
          text('course.benefit2', 'Benefit 2', 'Learn at your own pace', 100),
          text('course.benefit3', 'Benefit 3', 'Structured video lessons', 100),
        ],
      },
    ],
  },
  {
    id: 'about',
    title: 'About',
    icon: 'bi-info-circle',
    note: 'This site\'s About content is the "Why ICDS / About" section on the homepage (the header "About" link scrolls to it). Edit it under Homepage > Why ICDS / About section; there is no separate About page.',
    forms: [],
  },
  {
    id: 'instructors',
    title: 'Instructors',
    icon: 'bi-person-badge',
    note: 'Section headings are edited under Homepage > Instructors section. Instructor cards (name, designation, photo, social links, active state) are managed in Admin > Instructors.',
    forms: [],
  },
  {
    id: 'reviews',
    title: 'Reviews',
    icon: 'bi-star',
    note: 'Section headings are edited under Homepage > Reviews section. Approve or hide student reviews in Admin > Reviews.',
    forms: [],
  },
  {
    id: 'faq',
    title: 'FAQ',
    icon: 'bi-question-circle',
    note: 'Section headings are edited under Homepage > FAQ section. Questions and answers are managed in Admin > FAQs.',
    forms: [],
  },
  {
    id: 'contact',
    title: 'Contact',
    icon: 'bi-envelope',
    forms: [
      {
        id: 'page',
        title: 'Contact page',
        description: 'The email, phone and address shown on this page come from Brand & Global > Contact details. The form itself is unchanged.',
        fields: [
          text('contactPage.heading', 'Page heading', 'Contact Us'),
          area('contactPage.intro', 'Intro text', 'Send our team a message and we will respond when email delivery is configured.'),
          text('contactPage.formHeading', 'Form heading', '', SHORT, { help: 'Optional. Leave blank to show no heading above the form.' }),
          label('contactPage.nameLabel', 'Name label', 'Name'),
          label('contactPage.emailLabel', 'Email label', 'Email'),
          label('contactPage.subjectLabel', 'Subject label', 'Subject'),
          label('contactPage.messageLabel', 'Message label', 'Message'),
          label('contactPage.submitLabel', 'Submit button', 'Send Message'),
          text('contactPage.successMessage', 'Success message', 'Your message has been received.'),
          text('contactPage.infoHeading', 'Contact-information heading', 'Contact Information'),
          seoTitle('seo.contact.title'),
          seoDesc('seo.contact.description'),
        ],
      },
    ],
  },
  {
    id: 'newsletter',
    title: 'Newsletter',
    icon: 'bi-megaphone',
    note: 'The newsletter section is edited under Homepage > Newsletter section. Subscribers are listed in Admin > Newsletter.',
    forms: [],
  },
  {
    id: 'footer',
    title: 'Footer',
    icon: 'bi-layout-text-window-reverse',
    forms: [
      {
        id: 'main',
        title: 'Footer content',
        description: 'Categories come from the database. Contact details come from Brand & Global.',
        fields: [
          area('brand.footerDescription', 'Footer description', 'A professional learning platform for cosmetology, aesthetics, dental sciences, skin, hair and beauty education.'),
          text('footer.copyrightNotice', 'Text after the copyright name', 'All Rights Reserved.', 100),
          sub('Column headings'),
          label('footer.platformHeading', 'Platform', 'Platform'),
          label('footer.categoriesHeading', 'Categories', 'Categories'),
          label('footer.studentHeading', 'Student', 'Student'),
          label('footer.contactHeading', 'Contact', 'Contact'),
          sub('Platform links'),
          label('footer.allCoursesLabel', 'All courses', 'All Courses'),
          label('footer.categoriesLinkLabel', 'Categories', 'Categories'),
          label('footer.instructorsLabel', 'Instructors', 'Instructors'),
          label('footer.reviewsLabel', 'Reviews', 'Reviews'),
          label('footer.faqLabel', 'FAQ', 'FAQ'),
          sub('Student links'),
          label('footer.dashboardLabel', 'Dashboard', 'Dashboard'),
          label('footer.loginLabel', 'Login', 'Login'),
          label('footer.createAccountLabel', 'Create account', 'Create Account'),
          label('footer.myCoursesLabel', 'My courses', 'My Courses'),
          label('footer.certificatesLabel', 'Certificates', 'Certificates'),
          label('footer.helpLabel', 'Help center', 'Help Center'),
          sub('Contact links'),
          label('footer.contactUsLabel', 'Contact us', 'Contact Us'),
          sub('Legal links'),
          label('footer.privacyLabel', 'Privacy', 'Privacy Policy'),
          label('footer.termsLabel', 'Terms', 'Terms & Conditions'),
          sub('Support pop-up (floating help button)'),
          label('footer.supportHeading', 'Heading', 'Need Help?'),
          text('footer.supportText', 'Text', 'Our team is here to assist you.'),
          label('footer.whatsappLabel', 'WhatsApp option title', 'WhatsApp Support'),
          text('footer.whatsappText', 'WhatsApp option text', 'Chat with our support team.'),
          label('footer.emailSupportLabel', 'Email option title', 'Email Support'),
        ],
      },
    ],
  },
  {
    id: 'auth',
    title: 'Login / Signup',
    icon: 'bi-box-arrow-in-right',
    forms: [
      {
        id: 'login',
        title: 'Login page',
        description: 'Validation and security messages are fixed by the application and cannot be edited.',
        fields: [
          text('login.heading', 'Heading', 'Student Login'),
          text('login.description', 'Description', 'Sign in to continue learning.'),
          label('login.emailLabel', 'Email label', 'Email Address'),
          label('login.passwordLabel', 'Password label', 'Password'),
          label('login.submitLabel', 'Login button', 'Login to Account'),
          label('login.forgotLabel', '"Forgot password" link', 'Forgot Password?'),
          text('login.signupPrompt', 'Sign-up prompt', "Don't have an account?", 80),
          label('login.signupLabel', 'Sign-up link', 'Create one'),
          sub('Side panel'),
          text('login.sideHeading', 'Heading', 'Welcome back.'),
          area('login.sideBody', 'Body', 'Continue your learning journey and access all your purchased courses from one place.', DESC, { rows: 2 }),
          text('login.sideFeature1', 'Point 1', 'Access your purchased courses'),
          text('login.sideFeature2', 'Point 2', 'Track your learning progress'),
          text('login.sideFeature3', 'Point 3', 'Download eligible certificates'),
          image('login.imagePath', 'Side-panel image', { help: 'Optional picture shown at the top of the side panel.' }),
        ],
      },
      {
        id: 'signup',
        title: 'Sign-up page',
        description: 'The password rule shown to students always reflects the real validation (minimum 8 characters) and cannot be edited.',
        fields: [
          text('signup.heading', 'Heading', 'Create Account'),
          text('signup.description', 'Description', 'Join thousands of learners.'),
          label('signup.nameLabel', 'Name label', 'Full Name'),
          label('signup.emailLabel', 'Email label', 'Email Address'),
          label('signup.passwordLabel', 'Password label', 'Password'),
          label('signup.confirmLabel', 'Confirm password label', 'Confirm Password'),
          label('signup.submitLabel', 'Sign-up button', 'Create Student Account'),
          text('signup.loginPrompt', 'Login prompt', 'Already have an account?', 80),
          label('signup.loginLabel', 'Login link', 'Log in'),
          sub('Side panel'),
          text('signup.sideHeading', 'Heading', 'Start learning today.'),
          area('signup.sideBody', 'Body', 'Create your student account and start building professional skills through expert-led courses.', DESC, { rows: 2 }),
          text('signup.sideFeature1', 'Point 1', 'One account for all courses'),
          text('signup.sideFeature2', 'Point 2', 'Personal learning dashboard'),
          text('signup.sideFeature3', 'Point 3', 'Track progress and certificates'),
          image('signup.imagePath', 'Side-panel image', { help: 'Optional picture shown at the top of the side panel.' }),
        ],
      },
      {
        id: 'forgot',
        title: 'Forgot password page',
        description: 'The confirmation shown after a request is fixed on purpose so it can never reveal whether an account exists.',
        fields: [
          text('forgot.heading', 'Heading', 'Forgot Password'),
          text('forgot.description', 'Description', "Enter your registered email address and we'll send you a password reset link."),
          label('forgot.emailLabel', 'Email label', 'Email Address'),
          label('forgot.submitLabel', 'Button label', 'Send Reset Instructions'),
          label('forgot.backLabel', 'Back-to-login link', 'Back to login'),
        ],
      },
      {
        id: 'reset',
        title: 'Reset password page',
        description: 'The password rule (minimum 12 characters) is enforced by the application and cannot be edited.',
        fields: [
          text('reset.heading', 'Heading', 'Reset Password'),
          text('reset.description', 'Description', 'Choose a new password for your account.'),
          label('reset.passwordLabel', 'New password label', 'New Password'),
          label('reset.confirmLabel', 'Confirm password label', 'Confirm New Password'),
          label('reset.submitLabel', 'Button label', 'Reset Password'),
        ],
      },
    ],
  },
  {
    id: 'student',
    title: 'Student-facing Copy',
    icon: 'bi-mortarboard',
    forms: [
      {
        id: 'dashboard',
        title: 'Student dashboard',
        description: 'Counts, progress and course data are always real. Only generic labels are editable.',
        fields: [
          text('dash.welcomePrefix', 'Welcome prefix (student name follows)', 'Welcome back,', 60),
          text('dash.subtitle', 'Welcome subtitle', 'Continue learning and track your course progress.'),
          label('dash.continueHeading', '"Continue learning" heading', 'Continue Learning'),
          label('dash.startLabel', 'Button - course not started', 'Start Course'),
          label('dash.myCoursesHeading', '"My courses" heading', 'My Courses'),
          label('dash.progressLabel', 'Progress label', 'Progress'),
          label('dash.certificatesHeading', 'Certificates tile label', 'Certificates Earned'),
          label('dash.viewCertificatesLabel', 'View-certificates button', 'View Certificates'),
          text('dash.emptyHeading', 'Empty-state heading', '', SHORT, { help: 'Optional. Leave blank to show no heading.' }),
          text('dash.emptyBody', 'Empty-state text', 'You have not enrolled in any courses yet.'),
          label('dash.browseLabel', 'Browse-courses button', 'Browse Courses'),
          label('dash.quickLinksHeading', 'Quick links heading', 'Quick Links'),
          label('dash.quickCoursesLabel', 'Quick link - courses', 'My Courses'),
          label('dash.quickProfileLabel', 'Quick link - profile', 'Profile'),
          label('dash.quickPasswordLabel', 'Quick link - password', 'Change Password'),
          label('dash.quickCertificatesLabel', 'Quick link - certificates', 'Certificates'),
          label('dash.quickHelpLabel', 'Quick link - help', 'Contact / Help'),
        ],
      },
      {
        id: 'lesson',
        title: 'Lesson page',
        description: 'Completion rules and thresholds are enforced by the application and cannot be changed here.',
        fields: [
          text('lesson.backLabel', 'Back link ({course} = course title)', 'Back to {course}', 80),
          label('lesson.progressLabel', 'Progress label', 'Progress'),
          label('lesson.completedLabel', 'Completed label', 'Completed'),
          label('lesson.markCompleteLabel', 'Mark-complete button', 'Mark Complete'),
          text('lesson.autoCompleteHelp', 'Automatic-completion helper text', 'This lesson is marked complete automatically once you have watched it.'),
          label('lesson.previousLabel', 'Previous lesson button', 'Previous'),
          label('lesson.nextLabel', 'Next lesson button', 'Next'),
          label('lesson.curriculumHeading', 'Curriculum heading', 'Curriculum'),
          text('lesson.unavailableText', 'Video-unavailable message', 'Video unavailable or unsupported.'),
        ],
      },
      {
        id: 'certificates',
        title: 'Certificates',
        description: 'Certificate numbers, names and dates always come from the issued certificate.',
        fields: [
          text('cert.heading', 'Certificates page heading', 'My Certificates'),
          text('cert.supportText', 'Supporting text under the heading', '', SHORT, { help: 'Optional. Leave blank to show nothing.' }),
          text('cert.emptyTitle', 'Empty-state heading', 'No certificates yet'),
          text('cert.emptyText', 'Empty-state text', 'Certificates are issued once you complete every published lesson in an active course.'),
          text('cert.verifyHeading', 'Verification page heading', 'Certificate Verification'),
          text('cert.verifyHelper', 'Verification helper text', '', SHORT, { help: 'Optional. Leave blank to show nothing.' }),
        ],
      },
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy',
    icon: 'bi-shield-check',
    forms: [
      {
        id: 'page',
        title: 'Privacy Policy page',
        fields: [
          text('legal.privacy.heading', 'Page heading', 'Privacy Policy'),
          { key: 'legal.privacy.updated', label: 'Last updated', type: 'date', def: '', blankClears: true },
          { key: 'legal.privacy.body', label: 'Content', type: 'longtext', def: PRIVACY_BODY, max: 20000, rows: 16, blankClears: true, legalHelp: true, provisionalKey: 'privacy' },
          seoTitle('seo.privacy.title'),
          seoDesc('seo.privacy.description'),
        ],
      },
    ],
  },
  {
    id: 'terms',
    title: 'Terms',
    icon: 'bi-file-earmark-text',
    forms: [
      {
        id: 'page',
        title: 'Terms & Conditions page',
        fields: [
          text('legal.terms.heading', 'Page heading', 'Terms & Conditions'),
          { key: 'legal.terms.updated', label: 'Last updated', type: 'date', def: '', blankClears: true },
          { key: 'legal.terms.body', label: 'Content', type: 'longtext', def: TERMS_BODY, max: 20000, rows: 16, blankClears: true, legalHelp: true, provisionalKey: 'terms' },
          seoTitle('seo.terms.title'),
          seoDesc('seo.terms.description'),
        ],
      },
    ],
  },
];

// --- derived lookups ---------------------------------------------------------
const FIELD_BY_KEY = new Map();
const FORM_BY_PATH = new Map(); // "tab/form" -> { tab, form }

for (const tab of TABS) {
  for (const form of tab.forms) {
    FORM_BY_PATH.set(`${tab.id}/${form.id}`, { tab, form });
    for (const field of form.fields) {
      if (field.heading) continue;
      if (FIELD_BY_KEY.has(field.key)) throw new Error(`Duplicate site content key: ${field.key}`);
      FIELD_BY_KEY.set(field.key, field);
    }
  }
}

const DEFAULTS = {};
for (const [key, field] of FIELD_BY_KEY) DEFAULTS[key] = field.def;

const IMAGE_KEYS = [...FIELD_BY_KEY.values()].filter((f) => f.type === 'image').map((f) => f.key);
const BOOLEAN_KEYS = new Set([...FIELD_BY_KEY.values()].filter((f) => f.type === 'bool').map((f) => f.key));

module.exports = {
  TABS,
  LINK_TARGETS,
  SAFE_CTA_TARGETS,
  FIELD_BY_KEY,
  FORM_BY_PATH,
  DEFAULTS,
  IMAGE_KEYS,
  BOOLEAN_KEYS,
};
