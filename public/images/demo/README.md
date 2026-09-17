# public/images/demo

Demo/marketing photography used for the ICDS LMS frontend polish pass.

All images are sourced from [Pexels](https://www.pexels.com), distributed
under the [Pexels License](https://www.pexels.com/license/) (free for
commercial and non-commercial use, no attribution required). Each file was
downsized and re-encoded (JPEG, ~35–140KB) for web delivery; originals are
not committed.

| File | Source photo |
|---|---|
| `hero.jpg` / `auth.jpg` | pexels.com/photo/woman-getting-a-new-haircut-7755223 (RDNE Stock project) |
| `course-cosmetology.jpg` / `category-cosmetology.jpg` | pexels.com/photo/a-woman-cleaning-the-table-of-a-salon-8834022 (Kampus Production) |
| `course-aesthetics.jpg` | pexels.com/photo/specialist-making-face-skin-procedure-with-modern-equipment-5069612 (Anna Shvets) |
| `category-aesthetics.jpg` | pexels.com/photo/person-hands-relaxation-sitting-6417971 (Pavel Danilyuk) |
| `category-dental.jpg` | pexels.com/photo/modern-dental-equipment-on-table-in-light-room-in-clinic-3845729 (Anna Shvets) |
| `category-skin-hair.jpg` | pexels.com/photo/person-washing-woman-s-hair-3993449 (cottonbro studio) |
| `about-training.jpg` | pexels.com/photo/multiracial-students-studying-with-netbook-and-notebook-near-coffee-cup-6147391 (Keira Burton) |

These replace the generated SVG placeholders previously produced by
`scripts/setup-minimal-demo.js` and the inline SVGs in
`public/assets/images/`. Course thumbnails are referenced directly by URL
(`/images/demo/...`) from the DB `thumbnailUrl` field — no upload-storage
bookkeeping needed since these are static, committed files.
