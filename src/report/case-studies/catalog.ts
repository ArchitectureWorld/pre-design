import type { VerifiedCaseStudy } from './types.ts'

/** Public source responses and source-image hashes captured on 2026-09-18/19.
 * This is a bounded built-project catalog, not a pretend live web-search provider.
 * Built-project verification does not certify spatial coverage: incomplete entries remain candidates.
 * To expand coverage, add independently captured completion, feature and point/line/area evidence. */
export const VERIFIED_CASE_STUDIES: readonly VerifiedCaseStudy[] = [
  {
    "caseId": "damushan",
    "name": "松阳大木山茶室",
    "location": "浙江·丽水·松阳",
    "delivery": {
      "status": "completed",
      "date": "2015-08",
      "proof": "completion-record",
      "evidenceIds": [
        "case-evidence:damushan:built"
      ]
    },
    "summary": "临水茶室将公共茶饮、茶艺培训与开放步道组织在同一场地，既容纳休憩，也形成连续游逛。",
    "lesson": "以茶室留客，以开放游线串联景观。",
    "features": [
      {
        "id": "tea-landscape",
        "dimension": "environment",
        "label": "茶园景观",
        "fact": "茶室坐落于大木山茶园，茶田构成周边景观。",
        "evidenceIds": [
          "case-evidence:damushan:site"
        ],
        "application": "让茶园景观与休憩节点共同构成游览目的地。"
      },
      {
        "id": "tea-experience",
        "dimension": "function",
        "label": "茶饮体验",
        "fact": "公共茶室提供茶饮、简餐和定期茶艺培训。",
        "evidenceIds": [
          "case-evidence:damushan:program"
        ],
        "application": "以品饮和短时茶事活动延长停留。"
      },
      {
        "id": "slow-travel",
        "dimension": "scene",
        "label": "连续慢行",
        "fact": "开放公共走道与茶室组织成连续的八字回路。",
        "evidenceIds": [
          "case-evidence:damushan:walk"
        ],
        "application": "用连续步道连接体验节点，减少原路往返。"
      },
      {
        "id": "waterfront",
        "dimension": "environment",
        "label": "库岸景观",
        "fact": "茶室面向水库，形成临水休憩空间。",
        "evidenceIds": [
          "case-evidence:damushan:site"
        ],
        "application": "以水岸视线组织休憩空间的朝向。"
      }
    ],
    "boundary": {
      "fact": "案例以约478平方米的茶室单体为核心。",
      "applicationLimit": "可借鉴游线与茶饮的组合，接待规模应由本项目承载条件确定。",
      "evidenceIds": [
        "case-evidence:damushan:scale"
      ]
    },
    "evidence": [
      {
        "evidenceId": "case-evidence:damushan:built",
        "sourceUrl": "https://www.gooood.cn/church-of-tea-songyang-damushan-tea-house-by-dna_-design-and-architecture.htm",
        "sourceTitle": "松阳大木山茶室",
        "publisher": "谷德设计网；项目资料由 DnA 建筑事务所提供",
        "publishedAt": "2015-11-24",
        "capturedAt": "2026-09-18T02:30:08.185035Z",
        "contentHash": "c11eeb543d033967b7befdf6da8962267725ad6083f5a56ccc3e437f5746efa7",
        "excerpt": "竣工时间：2015.08",
        "excerptHash": "2f4a73dd0dd70a05648e7b2c24bf9bba9667cc558baa52b6aea60e912b887037",
        "locator": {
          "kind": "exact-text",
          "text": "竣工时间：2015.08"
        }
      },
      {
        "evidenceId": "case-evidence:damushan:site",
        "sourceUrl": "https://www.gooood.cn/church-of-tea-songyang-damushan-tea-house-by-dna_-design-and-architecture.htm",
        "sourceTitle": "松阳大木山茶室",
        "publisher": "谷德设计网；项目资料由 DnA 建筑事务所提供",
        "publishedAt": "2015-11-24",
        "capturedAt": "2026-09-18T02:30:08.185035Z",
        "contentHash": "c11eeb543d033967b7befdf6da8962267725ad6083f5a56ccc3e437f5746efa7",
        "excerpt": "茶室位于浙江省松阳县大木山茶园景区，面向西侧的水库，现状是一个较为狭长的线性场地，场地内保留了原有的五颗梧桐树，南侧建有一座线性的休憩长廊，为传统的坡顶形制。",
        "excerptHash": "997cf39c104bde8e0effdddde0de244262a9528c5222d65715e8b32496980de6",
        "locator": {
          "kind": "exact-text",
          "text": "茶室位于浙江省松阳县大木山茶园景区，面向西侧的水库，现状是一个较为狭长的线性场地，场地内保留了原有的五颗梧桐树，南侧建有一座线性的休憩长廊，为传统的坡顶形制。"
        }
      },
      {
        "evidenceId": "case-evidence:damushan:program",
        "sourceUrl": "https://www.gooood.cn/church-of-tea-songyang-damushan-tea-house-by-dna_-design-and-architecture.htm",
        "sourceTitle": "松阳大木山茶室",
        "publisher": "谷德设计网；项目资料由 DnA 建筑事务所提供",
        "publishedAt": "2015-11-24",
        "capturedAt": "2026-09-18T02:30:08.185035Z",
        "contentHash": "c11eeb543d033967b7befdf6da8962267725ad6083f5a56ccc3e437f5746efa7",
        "excerpt": "茶室建筑分为北侧的公共区块，提供喝茶简餐以及定期茶艺培训空间，和南侧的两个庭院茶室。",
        "excerptHash": "fe26d1cad0ee8eb55735119ca8ca578aac02e779e9d72722960ffc9c07d7487d",
        "locator": {
          "kind": "exact-text",
          "text": "茶室建筑分为北侧的公共区块，提供喝茶简餐以及定期茶艺培训空间，和南侧的两个庭院茶室。"
        }
      },
      {
        "evidenceId": "case-evidence:damushan:walk",
        "sourceUrl": "https://www.gooood.cn/church-of-tea-songyang-damushan-tea-house-by-dna_-design-and-architecture.htm",
        "sourceTitle": "松阳大木山茶室",
        "publisher": "谷德设计网；项目资料由 DnA 建筑事务所提供",
        "publishedAt": "2015-11-24",
        "capturedAt": "2026-09-18T02:30:08.185035Z",
        "contentHash": "c11eeb543d033967b7befdf6da8962267725ad6083f5a56ccc3e437f5746efa7",
        "excerpt": "一个开放的公共走道穿越地块，和建筑构成了循环的“8”字形回路，以“回廊”概念应对现状的“长廊”。",
        "excerptHash": "3c05a282a6eb5b7aabc5aa7d6e6ba6075bda87caa38a5dcda430562c3b98a872",
        "locator": {
          "kind": "exact-text",
          "text": "一个开放的公共走道穿越地块，和建筑构成了循环的“8”字形回路，以“回廊”概念应对现状的“长廊”。"
        }
      },
      {
        "evidenceId": "case-evidence:damushan:scale",
        "sourceUrl": "https://www.gooood.cn/church-of-tea-songyang-damushan-tea-house-by-dna_-design-and-architecture.htm",
        "sourceTitle": "松阳大木山茶室",
        "publisher": "谷德设计网；项目资料由 DnA 建筑事务所提供",
        "publishedAt": "2015-11-24",
        "capturedAt": "2026-09-18T02:30:08.185035Z",
        "contentHash": "c11eeb543d033967b7befdf6da8962267725ad6083f5a56ccc3e437f5746efa7",
        "excerpt": "建筑面积：477.75㎡ 占地面积:372.83㎡",
        "excerptHash": "be49f7457dcd8df745be45984dd95f23dcc61300930602035a22ee4465930646",
        "locator": {
          "kind": "exact-text",
          "text": "建筑面积：477.75㎡ 占地面积:372.83㎡"
        }
      },
      {
        "evidenceId": "case-evidence:damushan:tree-court",
        "sourceUrl": "https://www.gooood.cn/church-of-tea-songyang-damushan-tea-house-by-dna_-design-and-architecture.htm",
        "sourceTitle": "松阳大木山茶室",
        "publisher": "谷德设计网；项目资料由 DnA 建筑事务所提供",
        "publishedAt": "2015-11-24",
        "capturedAt": "2026-09-18T02:30:08.185035Z",
        "contentHash": "c11eeb543d033967b7befdf6da8962267725ad6083f5a56ccc3e437f5746efa7",
        "excerpt": "北侧体块退让到五颗梧桐树之后留出树下的公共活动区域，南侧则出挑水面。",
        "excerptHash": "642dc2b6b169017fadff4fc46c4cc6e215f11557b17b1de0cb84012df593168f",
        "locator": {
          "kind": "exact-text",
          "text": "北侧体块退让到五颗梧桐树之后留出树下的公共活动区域，南侧则出挑水面。"
        }
      },
      {
        "evidenceId": "case-evidence:damushan:courtyard",
        "sourceUrl": "https://www.gooood.cn/church-of-tea-songyang-damushan-tea-house-by-dna_-design-and-architecture.htm",
        "sourceTitle": "松阳大木山茶室",
        "publisher": "谷德设计网；项目资料由 DnA 建筑事务所提供",
        "publishedAt": "2015-11-24",
        "capturedAt": "2026-09-18T02:30:08.185035Z",
        "contentHash": "c11eeb543d033967b7befdf6da8962267725ad6083f5a56ccc3e437f5746efa7",
        "excerpt": "南侧两个临水庭院茶室，通过一条刻意压暗的走廊来铺垫引导。庭院茶室东西两侧的玻璃门，都是可以完全打开的，西侧面向外面的自然景观，如同框景。东侧是一个抽象的庭院，和一棵孤立的树。",
        "excerptHash": "5f58abd08e34f61e4ab9902a82002557dc8e8839a09e051efb86ceb93289677a",
        "locator": {
          "kind": "exact-text",
          "text": "南侧两个临水庭院茶室，通过一条刻意压暗的走廊来铺垫引导。庭院茶室东西两侧的玻璃门，都是可以完全打开的，西侧面向外面的自然景观，如同框景。东侧是一个抽象的庭院，和一棵孤立的树。"
        }
      },
      {
        "evidenceId": "case-evidence:damushan:area-drawing",
        "sourceUrl": "https://www.gooood.cn/church-of-tea-songyang-damushan-tea-house-by-dna_-design-and-architecture.htm",
        "sourceTitle": "松阳大木山茶室",
        "publisher": "谷德设计网；项目资料由 DnA 建筑事务所提供",
        "publishedAt": "2015-11-24",
        "capturedAt": "2026-09-18T02:30:08.185035Z",
        "contentHash": "c11eeb543d033967b7befdf6da8962267725ad6083f5a56ccc3e437f5746efa7",
        "excerpt": "茶室轴侧 axonometric drawings",
        "excerptHash": "4ee864f90f8eec60a64612185661b9d0b53c0f215e197f100bb0abe80927cadd",
        "locator": {
          "kind": "exact-text",
          "text": "茶室轴侧 axonometric drawings"
        }
      },
      {
        "evidenceId": "case-evidence:damushan:line-drawing",
        "sourceUrl": "https://www.gooood.cn/church-of-tea-songyang-damushan-tea-house-by-dna_-design-and-architecture.htm",
        "sourceTitle": "松阳大木山茶室",
        "publisher": "谷德设计网；项目资料由 DnA 建筑事务所提供",
        "publishedAt": "2015-11-24",
        "capturedAt": "2026-09-18T02:30:08.185035Z",
        "contentHash": "c11eeb543d033967b7befdf6da8962267725ad6083f5a56ccc3e437f5746efa7",
        "excerpt": "一层平面 1F",
        "excerptHash": "66cf9a9be8aee3ba3ae8833551effb285942405513bd4623fd9003b428f880f7",
        "locator": {
          "kind": "exact-text",
          "text": "一层平面 1F"
        }
      },
      {
        "evidenceId": "case-evidence:damushan:location",
        "sourceUrl": "https://www.gooood.cn/church-of-tea-songyang-damushan-tea-house-by-dna_-design-and-architecture.htm",
        "sourceTitle": "松阳大木山茶室",
        "publisher": "谷德设计网；项目资料由 DnA 建筑事务所提供",
        "publishedAt": "2015-11-24",
        "capturedAt": "2026-09-18T02:30:08.185035Z",
        "contentHash": "c11eeb543d033967b7befdf6da8962267725ad6083f5a56ccc3e437f5746efa7",
        "excerpt": "项目地点：浙江省丽水市松阳县大木山骑行茶园",
        "excerptHash": "573990b64400590677393b4d1e2a3ec528c04c2df917ced9e9c90a7c6a72d7e4",
        "locator": {
          "kind": "exact-text",
          "text": "项目地点：浙江省丽水市松阳县大木山骑行茶园"
        }
      }
    ],
    "image": {
      "sourceUrl": "https://oss.gooood.cn/uploads/2015/11/030-Songyang-Damushan-Tea-House%E8%8C%B6%E5%AE%A4%E8%BD%B4%E4%BE%A7-960x706.jpg",
      "sourcePageUrl": "https://www.gooood.cn/church-of-tea-songyang-damushan-tea-house-by-dna_-design-and-architecture.htm",
      "width": 960,
      "height": 706,
      "sha256": "2f5870808f2658318484e8d654e053403c84695e936e298628f11a68941c568c",
      "mimeType": "image/jpeg",
      "credit": "DnA 建筑事务所；谷德设计网项目发布页",
      "description": "大木山茶室、原有长廊与相邻库岸",
      "imageQuality": {
        "contentKind": "plan",
        "sourceLocation": "浙江·丽水·松阳"
      },
      "analysisScale": "area",
      "mediaPurpose": "area-overview",
      "imageIdentity": {
        "originalId": "sha256:2f5870808f2658318484e8d654e053403c84695e936e298628f11a68941c568c",
        "fileSha256": "2f5870808f2658318484e8d654e053403c84695e936e298628f11a68941c568c",
        "verification": "file-hash"
      },
      "locationEvidenceIds": [
        "case-evidence:damushan:location"
      ]
    },
    "analysis": [
      {
        "focus": "site",
        "title": "面｜茶室与库岸",
        "claim": "以477.75平方米茶室连接长廊、树荫与库岸。",
        "body": [
          "浙江松阳，茶室位于大木山茶园景区，面向西侧水库；建筑面积477.75平方米，占地372.83平方米。",
          "建筑沿狭长场地展开，北侧退让原有梧桐树，南侧面向水面；原有长廊与公共活动场地共同构成完整的建筑节点。"
        ],
        "evidenceIds": [
          "case-evidence:damushan:site",
          "case-evidence:damushan:tree-court",
          "case-evidence:damushan:scale",
          "case-evidence:damushan:area-drawing"
        ],
        "scales": [
          "area"
        ]
      },
      {
        "focus": "experience",
        "title": "点｜茶事体验",
        "claim": "以公共茶饮承接日常游览，以庭院茶室容纳安静停留。",
        "body": [
          "北侧公共区承接喝茶、简餐和定期茶艺培训，将休憩消费与茶文化体验集中在一个节点。",
          "南侧设置两处庭院茶室，形成与公共茶厅不同的空间节奏，同一场地提供开放交流和小范围品茶两类体验。"
        ],
        "evidenceIds": [
          "case-evidence:damushan:program",
          "case-evidence:damushan:courtyard"
        ],
        "scales": [
          "point"
        ]
      },
      {
        "focus": "organization",
        "title": "线｜游线与庭院",
        "claim": "开放回路串联建筑，庭院与水景组织停留层次。",
        "body": [
          "公共走道穿越地块，与建筑共同组成“8”字形回路。游线保持开放，茶室成为沿途可进入的停留节点。",
          "庭院茶室通过较暗的走廊进入；东西两侧玻璃门分别面向水景与内庭院，借视线转换形成空间层次。"
        ],
        "evidenceIds": [
          "case-evidence:damushan:walk",
          "case-evidence:damushan:courtyard"
        ],
        "scales": [
          "line"
        ]
      }
    ],
    "gallery": [
      {
        "imageId": "site",
        "sourceUrl": "https://oss.gooood.cn/uploads/2015/11/030-Songyang-Damushan-Tea-House%E8%8C%B6%E5%AE%A4%E8%BD%B4%E4%BE%A7-960x706.jpg",
        "sourcePageUrl": "https://www.gooood.cn/church-of-tea-songyang-damushan-tea-house-by-dna_-design-and-architecture.htm",
        "width": 960,
        "height": 706,
        "sha256": "2f5870808f2658318484e8d654e053403c84695e936e298628f11a68941c568c",
        "mimeType": "image/jpeg",
        "credit": "DnA 建筑事务所；谷德设计网项目发布页",
        "description": "大木山茶室、原有长廊与相邻库岸",
        "evidenceIds": [
          "case-evidence:damushan:site",
          "case-evidence:damushan:scale",
          "case-evidence:damushan:area-drawing"
        ],
        "imageQuality": {
          "contentKind": "plan",
          "sourceLocation": "浙江·丽水·松阳"
        },
        "analysisScale": "area",
        "mediaPurpose": "area-overview",
        "imageIdentity": {
          "originalId": "sha256:2f5870808f2658318484e8d654e053403c84695e936e298628f11a68941c568c",
          "fileSha256": "2f5870808f2658318484e8d654e053403c84695e936e298628f11a68941c568c",
          "verification": "file-hash"
        },
        "locationEvidenceIds": [
          "case-evidence:damushan:location"
        ]
      },
      {
        "sourceUrl": "https://oss.gooood.cn/uploads/2015/11/004-Songyang-Damushan-Tea-House7-960x375.jpg",
        "width": 960,
        "height": 375,
        "sha256": "ae4b745c99f7af418ea9aa9b3ef5095ecbb845af692404615242ff7fe4043806",
        "mimeType": "image/jpeg",
        "sourcePageUrl": "https://www.gooood.cn/church-of-tea-songyang-damushan-tea-house-by-dna_-design-and-architecture.htm",
        "credit": "项目图片由 DnA 建筑事务所通过谷德设计网发布；原文未列摄影者",
        "description": "公共茶厅的座席与自然光",
        "imageId": "experience",
        "evidenceIds": [
          "case-evidence:damushan:program"
        ],
        "analysisScale": "point",
        "mediaPurpose": "representative-point",
        "imageIdentity": {
          "originalId": "sha256:ae4b745c99f7af418ea9aa9b3ef5095ecbb845af692404615242ff7fe4043806",
          "fileSha256": "ae4b745c99f7af418ea9aa9b3ef5095ecbb845af692404615242ff7fe4043806",
          "verification": "file-hash"
        },
        "imageQuality": {
          "contentKind": "photo",
          "sourceLocation": "浙江·丽水·松阳"
        },
        "locationEvidenceIds": [
          "case-evidence:damushan:location"
        ]
      },
      {
        "imageId": "organization",
        "sourceUrl": "https://oss.gooood.cn/uploads/2015/11/032-Songyang-Damushan-Tea-House%E4%B8%80%E5%B1%82%E5%B9%B3%E9%9D%A2%E5%9B%BE-960x421.jpg",
        "sourcePageUrl": "https://www.gooood.cn/church-of-tea-songyang-damushan-tea-house-by-dna_-design-and-architecture.htm",
        "width": 960,
        "height": 421,
        "sha256": "79ae28e6defd778895e17ac4ecda20cf611a2022979393df04a0155296133601",
        "mimeType": "image/jpeg",
        "credit": "DnA 建筑事务所；谷德设计网项目发布页",
        "description": "一层平面中的公共走道、茶厅与庭院",
        "evidenceIds": [
          "case-evidence:damushan:walk",
          "case-evidence:damushan:courtyard",
          "case-evidence:damushan:line-drawing"
        ],
        "imageQuality": {
          "contentKind": "plan",
          "sourceLocation": "浙江·丽水·松阳"
        },
        "analysisScale": "line",
        "mediaPurpose": "circulation",
        "imageIdentity": {
          "originalId": "sha256:79ae28e6defd778895e17ac4ecda20cf611a2022979393df04a0155296133601",
          "fileSha256": "79ae28e6defd778895e17ac4ecda20cf611a2022979393df04a0155296133601",
          "verification": "file-hash"
        },
        "locationEvidenceIds": [
          "case-evidence:damushan:location"
        ]
      },
      {
        "sourceUrl": "https://oss.gooood.cn/uploads/2015/11/018-Songyang-Damushan-Tea-House13-960x637.jpg",
        "width": 960,
        "height": 637,
        "sha256": "af48f7f799029109e52efcc7c35b20ba00338b631f1d876093952073e687c852",
        "mimeType": "image/jpeg",
        "sourcePageUrl": "https://www.gooood.cn/church-of-tea-songyang-damushan-tea-house-by-dna_-design-and-architecture.htm",
        "credit": "项目图片由 DnA 建筑事务所通过谷德设计网发布；原文未列摄影者",
        "description": "茶室沿水岸展开的建筑界面",
        "imageId": "application",
        "evidenceIds": [
          "case-evidence:damushan:site",
          "case-evidence:damushan:program",
          "case-evidence:damushan:walk"
        ],
        "analysisScale": "point",
        "mediaPurpose": "application",
        "imageIdentity": {
          "originalId": "sha256:af48f7f799029109e52efcc7c35b20ba00338b631f1d876093952073e687c852",
          "fileSha256": "af48f7f799029109e52efcc7c35b20ba00338b631f1d876093952073e687c852",
          "verification": "file-hash"
        },
        "imageQuality": {
          "contentKind": "photo",
          "sourceLocation": "浙江·丽水·松阳"
        },
        "locationEvidenceIds": [
          "case-evidence:damushan:location"
        ]
      }
    ],
    "spatial": {
      "scope": {
        "kind": "building-site",
        "statement": "建筑面积477.75平方米的茶室、原有长廊与相邻库岸场地。",
        "evidenceIds": [
          "case-evidence:damushan:scale",
          "case-evidence:damushan:site"
        ],
        "measurements": [
          {
            "label": "建筑面积",
            "value": 477.75,
            "unit": "m2",
            "evidenceIds": [
              "case-evidence:damushan:scale"
            ]
          },
          {
            "label": "占地面积",
            "value": 372.83,
            "unit": "m2",
            "evidenceIds": [
              "case-evidence:damushan:scale"
            ]
          }
        ]
      },
      "area": {
        "evidenceIds": [
          "case-evidence:damushan:site",
          "case-evidence:damushan:scale",
          "case-evidence:damushan:area-drawing"
        ],
        "imageIds": [
          "site"
        ]
      },
      "line": {
        "evidenceIds": [
          "case-evidence:damushan:walk",
          "case-evidence:damushan:courtyard",
          "case-evidence:damushan:line-drawing"
        ],
        "imageIds": [
          "organization"
        ],
        "routes": [
          {
            "mode": "visitor",
            "claim": "公共走道穿越地块，与茶室构成八字回路。",
            "evidenceIds": [
              "case-evidence:damushan:walk"
            ],
            "sourceQuote": "一个开放的公共走道穿越地块，和建筑构成了循环的“8”字形回路，以“回廊”概念应对现状的“长廊”。"
          }
        ]
      },
      "point": {
        "evidenceIds": [
          "case-evidence:damushan:program",
          "case-evidence:damushan:courtyard"
        ],
        "imageIds": [
          "experience"
        ]
      },
      "sourceGaps": [
        {
          "scale": "line",
          "mode": "vehicle",
          "reason": "建筑发布页未记录外围车行、停车和接驳线路。",
          "blocking": false
        },
        {
          "scale": "line",
          "mode": "service",
          "reason": "平面标注备餐间，但未记录后勤运输和独立服务路线。",
          "blocking": false
        }
      ]
    }
  },
  {
    "caseId": "anji-tea",
    "name": "安吉观景平台及茶室",
    "location": "浙江·安吉",
    "delivery": {
      "status": "completed",
      "date": "2021",
      "proof": "completion-record",
      "evidenceIds": [
        "case-evidence:anji-tea:built"
      ]
    },
    "summary": "一间储藏室转化为茶室，两座观景亭分布于茶山高点，以小体量设施补充茶田中的休憩体验。",
    "lesson": "以少量服务节点打开茶园景观。",
    "features": [
      {
        "id": "tea-landscape",
        "dimension": "environment",
        "label": "茶园景观",
        "fact": "茶室与观景亭分布在安吉茶田之中。",
        "evidenceIds": [
          "case-evidence:anji-tea:site"
        ],
        "application": "保留茶田连续景观，以少量节点补充服务。"
      },
      {
        "id": "viewing",
        "dimension": "scene",
        "label": "景观游赏",
        "fact": "两座开放观景平台利用茶山制高点组织视野。",
        "evidenceIds": [
          "case-evidence:anji-tea:viewing"
        ],
        "application": "将观景节点布置在已有可达路径的视野开阔处。"
      },
      {
        "id": "adaptive-reuse",
        "dimension": "operation",
        "label": "旧房更新",
        "fact": "原乡政府储藏室经改造成为茶室。",
        "evidenceIds": [
          "case-evidence:anji-tea:reuse"
        ],
        "application": "优先利用既有建筑配置休憩和接待功能。"
      },
      {
        "id": "tea-experience",
        "dimension": "function",
        "label": "品茶休憩",
        "fact": "茶客可在面向茶田的开放界面品饮、赏景。",
        "evidenceIds": [
          "case-evidence:anji-tea:tea"
        ],
        "application": "让品饮空间朝向核心景观，形成室内外连续体验。"
      }
    ],
    "boundary": {
      "fact": "案例由260平方米茶室和两座观景亭组成。",
      "applicationLimit": "可借鉴小体量分散布局，建筑做法需顺应本项目地形与既有房屋条件。",
      "evidenceIds": [
        "case-evidence:anji-tea:scale"
      ]
    },
    "evidence": [
      {
        "evidenceId": "case-evidence:anji-tea:built",
        "sourceUrl": "https://www.gooood.cn/anji-sight-viewing-platform-and-tea-house-china-by-hatch-architects.htm",
        "sourceTitle": "安吉观景平台及茶室",
        "publisher": "谷德设计网；项目资料由汉齐建筑提供",
        "publishedAt": "2022-01-12",
        "capturedAt": "2026-09-18T02:30:05.188550Z",
        "contentHash": "afb25f062921cc16724182ab8a599d453aa7c40ab811082447960d95ef4fcf7f",
        "excerpt": "项目设计 & 完成年份：2021-2021",
        "excerptHash": "aed4a7e8077968008fa66e0dba72dad3a2adc756c5902606436a9662115510ad",
        "locator": {
          "kind": "exact-text",
          "text": "项目设计 & 完成年份：2021-2021"
        }
      },
      {
        "evidenceId": "case-evidence:anji-tea:site",
        "sourceUrl": "https://www.gooood.cn/anji-sight-viewing-platform-and-tea-house-china-by-hatch-architects.htm",
        "sourceTitle": "安吉观景平台及茶室",
        "publisher": "谷德设计网；项目资料由汉齐建筑提供",
        "publishedAt": "2022-01-12",
        "capturedAt": "2026-09-18T02:30:05.188550Z",
        "contentHash": "afb25f062921cc16724182ab8a599d453aa7c40ab811082447960d95ef4fcf7f",
        "excerpt": "HATCH Architects因地制宜地在浙江安吉的茶田中打造了一个茶室和两个竹亭，既具有围合向心的凝聚力，又和谐地融入在当地环境中。这个项目落址于由万亩茶田构成的乡野景观之中。",
        "excerptHash": "95dc665178f3f77ff29620dc4cc506dfe5f7f878fb6621a4e26977a77902f452",
        "locator": {
          "kind": "exact-text",
          "text": "HATCH Architects因地制宜地在浙江安吉的茶田中打造了一个茶室和两个竹亭，既具有围合向心的凝聚力，又和谐地融入在当地环境中。这个项目落址于由万亩茶田构成的乡野景观之中。"
        }
      },
      {
        "evidenceId": "case-evidence:anji-tea:viewing",
        "sourceUrl": "https://www.gooood.cn/anji-sight-viewing-platform-and-tea-house-china-by-hatch-architects.htm",
        "sourceTitle": "安吉观景平台及茶室",
        "publisher": "谷德设计网；项目资料由汉齐建筑提供",
        "publishedAt": "2022-01-12",
        "capturedAt": "2026-09-18T02:30:05.188550Z",
        "contentHash": "afb25f062921cc16724182ab8a599d453aa7c40ab811082447960d95ef4fcf7f",
        "excerpt": "在茶室以外，我们还设计了两座位于茶山制高点的开放式观景平台，它们的设计灵感源自这里的村民最引以为傲的物产——白茶。",
        "excerptHash": "7cb1ac0f0c51d286c94a631f59e25ad3aaa8af3a1747d8e6a71daacbd37a9081",
        "locator": {
          "kind": "exact-text",
          "text": "在茶室以外，我们还设计了两座位于茶山制高点的开放式观景平台，它们的设计灵感源自这里的村民最引以为傲的物产——白茶。"
        }
      },
      {
        "evidenceId": "case-evidence:anji-tea:reuse",
        "sourceUrl": "https://www.gooood.cn/anji-sight-viewing-platform-and-tea-house-china-by-hatch-architects.htm",
        "sourceTitle": "安吉观景平台及茶室",
        "publisher": "谷德设计网；项目资料由汉齐建筑提供",
        "publishedAt": "2022-01-12",
        "capturedAt": "2026-09-18T02:30:05.188550Z",
        "contentHash": "afb25f062921cc16724182ab8a599d453aa7c40ab811082447960d95ef4fcf7f",
        "excerpt": "茶室前身是一间乡政府的储藏室，秉承“微介入”的理念，我们以轻巧的手法对储藏室进行了改造与拓展。",
        "excerptHash": "1892561ba25b4d7ca9b042507f537377d3cd92616dd62ad11b870bc8442837fa",
        "locator": {
          "kind": "exact-text",
          "text": "茶室前身是一间乡政府的储藏室，秉承“微介入”的理念，我们以轻巧的手法对储藏室进行了改造与拓展。"
        }
      },
      {
        "evidenceId": "case-evidence:anji-tea:tea",
        "sourceUrl": "https://www.gooood.cn/anji-sight-viewing-platform-and-tea-house-china-by-hatch-architects.htm",
        "sourceTitle": "安吉观景平台及茶室",
        "publisher": "谷德设计网；项目资料由汉齐建筑提供",
        "publishedAt": "2022-01-12",
        "capturedAt": "2026-09-18T02:30:05.188550Z",
        "contentHash": "afb25f062921cc16724182ab8a599d453aa7c40ab811082447960d95ef4fcf7f",
        "excerpt": "气候适宜时，横向足有12米的折叠式落地窗可以全部打开，让茶客毫无阻拦地欣赏美景，享受不时吹来清风。",
        "excerptHash": "667eff031d289bfd35e1eafc6170664077906a2476c564793f7af7ea31407097",
        "locator": {
          "kind": "exact-text",
          "text": "气候适宜时，横向足有12米的折叠式落地窗可以全部打开，让茶客毫无阻拦地欣赏美景，享受不时吹来清风。"
        }
      },
      {
        "evidenceId": "case-evidence:anji-tea:scale",
        "sourceUrl": "https://www.gooood.cn/anji-sight-viewing-platform-and-tea-house-china-by-hatch-architects.htm",
        "sourceTitle": "安吉观景平台及茶室",
        "publisher": "谷德设计网；项目资料由汉齐建筑提供",
        "publishedAt": "2022-01-12",
        "capturedAt": "2026-09-18T02:30:05.188550Z",
        "contentHash": "afb25f062921cc16724182ab8a599d453aa7c40ab811082447960d95ef4fcf7f",
        "excerpt": "建筑面积：260平方米 景观面积：1300平方米",
        "excerptHash": "eba751cdca821f287662603f807701c3a143a2107f40e138d8e3cd02c7e3d0d4",
        "locator": {
          "kind": "exact-text",
          "text": "建筑面积：260平方米 景观面积：1300平方米"
        }
      },
      {
        "evidenceId": "case-evidence:anji-tea:landform",
        "sourceUrl": "https://www.gooood.cn/anji-sight-viewing-platform-and-tea-house-china-by-hatch-architects.htm",
        "sourceTitle": "安吉观景平台及茶室",
        "publisher": "谷德设计网；项目资料由汉齐建筑提供",
        "publishedAt": "2022-01-12",
        "capturedAt": "2026-09-18T02:30:05.188550Z",
        "contentHash": "afb25f062921cc16724182ab8a599d453aa7c40ab811082447960d95ef4fcf7f",
        "excerpt": "顺应茶园梯田的地理形态，采用嵌入的方法塑造出逐渐下降的茶室。在满足功能需求的同时，通过材料选择、形体塑造等方法弱化建筑的突兀感，与周遭环境融为一体。茶室内部则被打造成了大地色的“洞穴”，室内吧台、台阶的曲线如茶垄般蜿蜒，富有柔软顺滑的质感。",
        "excerptHash": "40f99653ae0ce3fa02baebf4f98e84037ef70ce0bd1f0cd07cbf95428cd062cb",
        "locator": {
          "kind": "exact-text",
          "text": "顺应茶园梯田的地理形态，采用嵌入的方法塑造出逐渐下降的茶室。在满足功能需求的同时，通过材料选择、形体塑造等方法弱化建筑的突兀感，与周遭环境融为一体。茶室内部则被打造成了大地色的“洞穴”，室内吧台、台阶的曲线如茶垄般蜿蜒，富有柔软顺滑的质感。"
        }
      },
      {
        "evidenceId": "case-evidence:anji-tea:location",
        "sourceUrl": "https://www.gooood.cn/anji-sight-viewing-platform-and-tea-house-china-by-hatch-architects.htm",
        "sourceTitle": "安吉观景平台及茶室",
        "publisher": "谷德设计网；项目资料由汉齐建筑提供",
        "publishedAt": "2022-01-12",
        "capturedAt": "2026-09-18T02:30:05.188550Z",
        "contentHash": "afb25f062921cc16724182ab8a599d453aa7c40ab811082447960d95ef4fcf7f",
        "excerpt": "项目地址：中国浙江安吉",
        "excerptHash": "5e2aed865a716f49ef040cf33030edfeb56b7586a94c8772ae4389f535aeb377",
        "locator": {
          "kind": "exact-text",
          "text": "项目地址：中国浙江安吉"
        }
      }
    ],
    "image": {
      "sourceUrl": "https://oss.gooood.cn/uploads/2022/01/007-Anji-Sight-viewing-Platform-and-Tea-House-China-by-HATCH-Architects.jpg",
      "width": 1700,
      "height": 1133,
      "sha256": "d358bb55c18e5b67e5aeaaaabba7ebcc597af36dd3cea71fdac7750ad552cfce",
      "mimeType": "image/jpeg",
      "sourcePageUrl": "https://www.gooood.cn/anji-sight-viewing-platform-and-tea-house-china-by-hatch-architects.htm",
      "credit": "朱润资；汉齐建筑供稿／谷德设计网",
      "description": "安吉茶园中的观景平台与茶室",
      "analysisScale": "area",
      "mediaPurpose": "area-overview",
      "imageIdentity": {
        "originalId": "sha256:d358bb55c18e5b67e5aeaaaabba7ebcc597af36dd3cea71fdac7750ad552cfce",
        "fileSha256": "d358bb55c18e5b67e5aeaaaabba7ebcc597af36dd3cea71fdac7750ad552cfce",
        "verification": "file-hash"
      },
      "imageQuality": {
        "contentKind": "photo",
        "sourceLocation": "浙江·安吉"
      },
      "locationEvidenceIds": [
        "case-evidence:anji-tea:location"
      ]
    },
    "analysis": [
      {
        "focus": "site",
        "title": "茶田中的节点",
        "claim": "用一间茶室、两座竹亭补充茶田中的游憩体验。",
        "body": [
          "浙江安吉，项目置于连绵茶田之中。一间茶室与两座竹亭分担室内停留和户外观景，设施保持小尺度分布。",
          "茶室由乡政府原储藏室改造拓展，两个观景平台设置在茶山高点，以既有空间和地形条件选择服务落点。"
        ],
        "evidenceIds": [
          "case-evidence:anji-tea:site",
          "case-evidence:anji-tea:reuse",
          "case-evidence:anji-tea:viewing"
        ],
        "scales": [
          "area"
        ]
      },
      {
        "focus": "experience",
        "title": "坐进茶园风景",
        "claim": "让连续开窗成为茶饮空间最直接的体验内容。",
        "body": [
          "茶室设置横向 12 米折叠式落地窗，气候适宜时可全部开启，让室内座席直接面向茶田与山景。",
          "室内采用大地色调，吧台与台阶以曲线延续茶垄的形态。茶饮、观景和休憩由同一组空间关系共同承载。"
        ],
        "evidenceIds": [
          "case-evidence:anji-tea:tea",
          "case-evidence:anji-tea:landform"
        ],
        "scales": [
          "point"
        ]
      },
      {
        "focus": "organization",
        "title": "茶室与高点竹亭",
        "claim": "茶室顺应梯田嵌入，竹亭占据开阔的观景位置。",
        "body": [
          "茶室沿梯田逐级下降，通过材料与形体处理融入茶田。室内停留点与田间景观保持直接的视觉联系。",
          "两座开放式观景平台位于茶山制高点，与茶室形成不同高度、不同停留时长的节点组合。"
        ],
        "evidenceIds": [
          "case-evidence:anji-tea:landform",
          "case-evidence:anji-tea:viewing"
        ],
        "scales": [
          "line"
        ]
      }
    ],
    "gallery": [
      {
        "sourceUrl": "https://oss.gooood.cn/uploads/2022/01/007-Anji-Sight-viewing-Platform-and-Tea-House-China-by-HATCH-Architects.jpg",
        "width": 1700,
        "height": 1133,
        "sha256": "d358bb55c18e5b67e5aeaaaabba7ebcc597af36dd3cea71fdac7750ad552cfce",
        "mimeType": "image/jpeg",
        "sourcePageUrl": "https://www.gooood.cn/anji-sight-viewing-platform-and-tea-house-china-by-hatch-architects.htm",
        "credit": "朱润资；汉齐建筑供稿／谷德设计网",
        "description": "安吉茶园中的观景平台与茶室",
        "imageId": "site",
        "evidenceIds": [
          "case-evidence:anji-tea:site"
        ],
        "analysisScale": "area",
        "mediaPurpose": "area-overview",
        "imageIdentity": {
          "originalId": "sha256:d358bb55c18e5b67e5aeaaaabba7ebcc597af36dd3cea71fdac7750ad552cfce",
          "fileSha256": "d358bb55c18e5b67e5aeaaaabba7ebcc597af36dd3cea71fdac7750ad552cfce",
          "verification": "file-hash"
        },
        "imageQuality": {
          "contentKind": "photo",
          "sourceLocation": "浙江·安吉"
        },
        "locationEvidenceIds": [
          "case-evidence:anji-tea:location"
        ]
      },
      {
        "sourceUrl": "https://oss.gooood.cn/uploads/2022/01/005-Anji-Sight-viewing-Platform-and-Tea-House-China-by-HATCH-Architects-960x720.jpg",
        "width": 960,
        "height": 720,
        "sha256": "7cbad0da2954e016e96f2773ae65b45bfab28b538d766af87d7e1fd2f5005784",
        "mimeType": "image/jpeg",
        "sourcePageUrl": "https://www.gooood.cn/anji-sight-viewing-platform-and-tea-house-china-by-hatch-architects.htm",
        "credit": "朱润资；汉齐建筑供稿／谷德设计网",
        "description": "茶室座席与开放景窗",
        "imageId": "experience",
        "evidenceIds": [
          "case-evidence:anji-tea:tea",
          "case-evidence:anji-tea:landform"
        ],
        "analysisScale": "point",
        "mediaPurpose": "representative-point",
        "imageIdentity": {
          "originalId": "sha256:7cbad0da2954e016e96f2773ae65b45bfab28b538d766af87d7e1fd2f5005784",
          "fileSha256": "7cbad0da2954e016e96f2773ae65b45bfab28b538d766af87d7e1fd2f5005784",
          "verification": "file-hash"
        },
        "imageQuality": {
          "contentKind": "photo",
          "sourceLocation": "浙江·安吉"
        },
        "locationEvidenceIds": [
          "case-evidence:anji-tea:location"
        ]
      },
      {
        "sourceUrl": "https://oss.gooood.cn/uploads/2022/01/016-Anji-Sight-viewing-Platform-and-Tea-House-China-by-HATCH-Architects.jpg",
        "width": 1700,
        "height": 1275,
        "sha256": "4acd6fb069bf0069cf5dc4ebe4ae0105a99ae3c0ad0323e0094f9a79d478fbce",
        "mimeType": "image/jpeg",
        "sourcePageUrl": "https://www.gooood.cn/anji-sight-viewing-platform-and-tea-house-china-by-hatch-architects.htm",
        "credit": "朱润资；汉齐建筑供稿／谷德设计网",
        "description": "茶山高点的竹亭",
        "imageId": "organization",
        "evidenceIds": [
          "case-evidence:anji-tea:viewing"
        ],
        "analysisScale": "line",
        "mediaPurpose": "circulation",
        "imageIdentity": {
          "originalId": "sha256:4acd6fb069bf0069cf5dc4ebe4ae0105a99ae3c0ad0323e0094f9a79d478fbce",
          "fileSha256": "4acd6fb069bf0069cf5dc4ebe4ae0105a99ae3c0ad0323e0094f9a79d478fbce",
          "verification": "file-hash"
        },
        "imageQuality": {
          "contentKind": "photo",
          "sourceLocation": "浙江·安吉"
        },
        "locationEvidenceIds": [
          "case-evidence:anji-tea:location"
        ]
      },
      {
        "sourceUrl": "https://oss.gooood.cn/uploads/2022/01/006-Anji-Sight-viewing-Platform-and-Tea-House-China-by-HATCH-Architects.jpg",
        "width": 1700,
        "height": 956,
        "sha256": "a4b3cac8ed9ade27946eb2f3e7381c930d7d7ed4d67b401221d368a4776956b9",
        "mimeType": "image/jpeg",
        "sourcePageUrl": "https://www.gooood.cn/anji-sight-viewing-platform-and-tea-house-china-by-hatch-architects.htm",
        "credit": "朱润资；汉齐建筑供稿／谷德设计网",
        "description": "面向茶垄的连续景窗",
        "imageId": "application",
        "evidenceIds": [
          "case-evidence:anji-tea:tea",
          "case-evidence:anji-tea:landform"
        ],
        "analysisScale": "point",
        "mediaPurpose": "application",
        "imageIdentity": {
          "originalId": "sha256:a4b3cac8ed9ade27946eb2f3e7381c930d7d7ed4d67b401221d368a4776956b9",
          "fileSha256": "a4b3cac8ed9ade27946eb2f3e7381c930d7d7ed4d67b401221d368a4776956b9",
          "verification": "file-hash"
        },
        "imageQuality": {
          "contentKind": "photo",
          "sourceLocation": "浙江·安吉"
        },
        "locationEvidenceIds": [
          "case-evidence:anji-tea:location"
        ]
      }
    ],
    "spatial": {
      "scope": {
        "kind": "building-site",
        "statement": "一间茶室与两座观景亭；建筑面积260平方米，景观面积1300平方米。",
        "evidenceIds": [
          "case-evidence:anji-tea:site",
          "case-evidence:anji-tea:scale"
        ],
        "measurements": [
          {
            "label": "建筑面积",
            "value": 260,
            "unit": "m2",
            "evidenceIds": [
              "case-evidence:anji-tea:scale"
            ]
          },
          {
            "label": "景观面积",
            "value": 1300,
            "unit": "m2",
            "evidenceIds": [
              "case-evidence:anji-tea:scale"
            ]
          }
        ]
      },
      "area": {
        "evidenceIds": [
          "case-evidence:anji-tea:site",
          "case-evidence:anji-tea:scale"
        ],
        "imageIds": [
          "site"
        ]
      },
      "line": {
        "evidenceIds": [],
        "imageIds": [],
        "routes": []
      },
      "point": {
        "evidenceIds": [
          "case-evidence:anji-tea:tea",
          "case-evidence:anji-tea:viewing"
        ],
        "imageIds": [
          "experience"
        ]
      },
      "sourceGaps": [
        {
          "scale": "line",
          "mode": "visitor",
          "reason": "已读取原始茶室及观景平台平面，仍缺少茶室与两座观景亭的连续到达、游览关系；需补充来源或改选案例。",
          "blocking": true
        },
        {
          "scale": "line",
          "mode": "vehicle",
          "reason": "发布资料未记录车行和停车组织。",
          "blocking": false
        },
        {
          "scale": "line",
          "mode": "service",
          "reason": "发布资料未记录服务流线。",
          "blocking": false
        }
      ]
    }
  },
  {
    "caseId": "tianhu-lodge",
    "name": "天湖小舍·水库管理房改造",
    "location": "福建·福鼎·嵛山岛",
    "delivery": {
      "status": "completed",
      "date": "2024-10",
      "proof": "completion-record",
      "evidenceIds": [
        "case-evidence:tianhu-lodge:built"
      ]
    },
    "summary": "水库管理房保留监测、办公功能，并向游客开放休息、等候和茶咖空间，将基础设施转化为游线服务节点。",
    "lesson": "保留管理功能，为既有建筑增加公共服务。",
    "features": [
      {
        "id": "adaptive-reuse",
        "dimension": "operation",
        "label": "存量房更新",
        "fact": "原水库管理房改造后保留管理功能并增加公共服务。",
        "evidenceIds": [
          "case-evidence:tianhu-lodge:service"
        ],
        "application": "既有使用功能与游客服务分区组织、各自通行。"
      },
      {
        "id": "waterfront",
        "dimension": "environment",
        "label": "水库景观",
        "fact": "项目临湖而立，周边为水库、白茶茶园和草场。",
        "evidenceIds": [
          "case-evidence:tianhu-lodge:site"
        ],
        "application": "以既有岸线与建筑视线组织看水休憩。"
      },
      {
        "id": "visitor-service",
        "dimension": "function",
        "label": "游线服务",
        "fact": "公共休息空间位于游客下车点和环湖游线上。",
        "evidenceIds": [
          "case-evidence:tianhu-lodge:route"
        ],
        "application": "在集散与游线转换处配置休憩、等候服务。"
      },
      {
        "id": "tea-experience",
        "dimension": "function",
        "label": "茶饮停留",
        "fact": "向游客开放的首层设置茶咖空间。",
        "evidenceIds": [
          "case-evidence:tianhu-lodge:service"
        ],
        "application": "以品饮等轻量服务补充日间游览。"
      }
    ],
    "boundary": {
      "fact": "案例包含对水库管理房的加层改造。",
      "applicationLimit": "可借鉴管理与接待共存的分区方式，加层和临水建设须另按本项目条件判断。",
      "evidenceIds": [
        "case-evidence:tianhu-lodge:service"
      ]
    },
    "evidence": [
      {
        "evidenceId": "case-evidence:tianhu-lodge:built",
        "sourceUrl": "https://www.gooood.cn/tianhu-lake-lodge-reservoir-manag.htm",
        "sourceTitle": "天湖小舍·水库管理房改造",
        "publisher": "谷德设计网；项目资料由成为建筑提供",
        "publishedAt": "2025-12-31",
        "capturedAt": "2026-09-18T02:30:10.250285Z",
        "contentHash": "359a78999b0fdbb7354ffe3a2010f15bdaffbbfab006c836512495fcfc46c6f4",
        "excerpt": "完成年份：2024年10月",
        "excerptHash": "02fafafe8b93e67dbad3b529b1d1de44f26c684887c5704c2ecafa30946aa4a1",
        "locator": {
          "kind": "exact-text",
          "text": "完成年份：2024年10月"
        }
      },
      {
        "evidenceId": "case-evidence:tianhu-lodge:site",
        "sourceUrl": "https://www.gooood.cn/tianhu-lake-lodge-reservoir-manag.htm",
        "sourceTitle": "天湖小舍·水库管理房改造",
        "publisher": "谷德设计网；项目资料由成为建筑提供",
        "publishedAt": "2025-12-31",
        "capturedAt": "2026-09-18T02:30:10.250285Z",
        "contentHash": "359a78999b0fdbb7354ffe3a2010f15bdaffbbfab006c836512495fcfc46c6f4",
        "excerpt": "天湖小舍位于福建省福鼎市嵛山岛天湖核心景区，由原水库管理房旧址上改建而成，景色绝佳，临湖而立，湖对面是连绵的白茶茶园和海上草场。",
        "excerptHash": "70a188d308428fd6f098abb3df079fe99ec285836df6369fb17d528ca9cc52e6",
        "locator": {
          "kind": "exact-text",
          "text": "天湖小舍位于福建省福鼎市嵛山岛天湖核心景区，由原水库管理房旧址上改建而成，景色绝佳，临湖而立，湖对面是连绵的白茶茶园和海上草场。"
        }
      },
      {
        "evidenceId": "case-evidence:tianhu-lodge:service",
        "sourceUrl": "https://www.gooood.cn/tianhu-lake-lodge-reservoir-manag.htm",
        "sourceTitle": "天湖小舍·水库管理房改造",
        "publisher": "谷德设计网；项目资料由成为建筑提供",
        "publishedAt": "2025-12-31",
        "capturedAt": "2026-09-18T02:30:10.250285Z",
        "contentHash": "359a78999b0fdbb7354ffe3a2010f15bdaffbbfab006c836512495fcfc46c6f4",
        "excerpt": "改造后的水库管理房包含水库管理功能和公共服务功能两部分，在保留一层水库水位水质监测设备和二层水库工作人员办公住宿的同时，将一层的大部分空间作为公区对游客开放，提供休憩、等候和茶咖空间，并加建三层湖景茶室。",
        "excerptHash": "626abe5680df8454d24e34239897e69ab90c30fb984b8853d530511381ae0d4b",
        "locator": {
          "kind": "exact-text",
          "text": "改造后的水库管理房包含水库管理功能和公共服务功能两部分，在保留一层水库水位水质监测设备和二层水库工作人员办公住宿的同时，将一层的大部分空间作为公区对游客开放，提供休憩、等候和茶咖空间，并加建三层湖景茶室。"
        }
      },
      {
        "evidenceId": "case-evidence:tianhu-lodge:route",
        "sourceUrl": "https://www.gooood.cn/tianhu-lake-lodge-reservoir-manag.htm",
        "sourceTitle": "天湖小舍·水库管理房改造",
        "publisher": "谷德设计网；项目资料由成为建筑提供",
        "publishedAt": "2025-12-31",
        "capturedAt": "2026-09-18T02:30:10.250285Z",
        "contentHash": "359a78999b0fdbb7354ffe3a2010f15bdaffbbfab006c836512495fcfc46c6f4",
        "excerpt": "水库管理房原址恰好位于游客来到天湖景区的下车点，所以改造是难得的机会，可以在2.5公里的环湖旅游路线上为游客设置一个室内的休息空间，并且创造一个人与湖互动和对话的全新场景。",
        "excerptHash": "c97951e7dd19196e7a4ec50633c80dec1a4ed4e45156146818a439e4ae29791f",
        "locator": {
          "kind": "exact-text",
          "text": "水库管理房原址恰好位于游客来到天湖景区的下车点，所以改造是难得的机会，可以在2.5公里的环湖旅游路线上为游客设置一个室内的休息空间，并且创造一个人与湖互动和对话的全新场景。"
        }
      },
      {
        "evidenceId": "case-evidence:tianhu-lodge:scale",
        "sourceUrl": "https://www.gooood.cn/tianhu-lake-lodge-reservoir-manag.htm",
        "sourceTitle": "天湖小舍·水库管理房改造",
        "publisher": "谷德设计网；项目资料由成为建筑提供",
        "publishedAt": "2025-12-31",
        "capturedAt": "2026-09-18T02:30:10.250285Z",
        "contentHash": "359a78999b0fdbb7354ffe3a2010f15bdaffbbfab006c836512495fcfc46c6f4",
        "excerpt": "项目地址：福建福鼎 建筑面积：256㎡",
        "excerptHash": "bd4d94d0bcd7477ce2afb4e4ddc67d1108c90c272dc79b94f50e579f9147db0c",
        "locator": {
          "kind": "exact-text",
          "text": "项目地址：福建福鼎 建筑面积：256㎡"
        }
      },
      {
        "evidenceId": "case-evidence:tianhu-lodge:circulation",
        "sourceUrl": "https://www.gooood.cn/tianhu-lake-lodge-reservoir-manag.htm",
        "sourceTitle": "天湖小舍·水库管理房改造",
        "publisher": "谷德设计网；项目资料由成为建筑提供",
        "publishedAt": "2025-12-31",
        "capturedAt": "2026-09-18T02:30:10.250285Z",
        "contentHash": "359a78999b0fdbb7354ffe3a2010f15bdaffbbfab006c836512495fcfc46c6f4",
        "excerpt": "在交通流线上，我们将通往二层办公的楼梯段提前分叉，使其在游客通往三层的路径中消隐。",
        "excerptHash": "63fc4a9e46c1c1592ca4c8e6d1a4d9901891ba8aa9d25f11a042910bb7d445c7",
        "locator": {
          "kind": "exact-text",
          "text": "在交通流线上，我们将通往二层办公的楼梯段提前分叉，使其在游客通往三层的路径中消隐。"
        }
      },
      {
        "evidenceId": "case-evidence:tianhu-lodge:screen",
        "sourceUrl": "https://www.gooood.cn/tianhu-lake-lodge-reservoir-manag.htm",
        "sourceTitle": "天湖小舍·水库管理房改造",
        "publisher": "谷德设计网；项目资料由成为建筑提供",
        "publishedAt": "2025-12-31",
        "capturedAt": "2026-09-18T02:30:10.250285Z",
        "contentHash": "359a78999b0fdbb7354ffe3a2010f15bdaffbbfab006c836512495fcfc46c6f4",
        "excerpt": "我们运用整面的回收瓦片墙，在隐藏遮蔽办公走廊的同时保证采光和通风，并与波光粼粼的湖水相呼应。",
        "excerptHash": "aedd53c7697be1287e19377e1067bac8febb4447c54dbe94bbf1453c85480d9d",
        "locator": {
          "kind": "exact-text",
          "text": "我们运用整面的回收瓦片墙，在隐藏遮蔽办公走廊的同时保证采光和通风，并与波光粼粼的湖水相呼应。"
        }
      },
      {
        "evidenceId": "case-evidence:tianhu-lodge:area-drawing",
        "sourceUrl": "https://www.gooood.cn/tianhu-lake-lodge-reservoir-manag.htm",
        "sourceTitle": "天湖小舍·水库管理房改造",
        "publisher": "谷德设计网；项目资料由成为建筑提供",
        "publishedAt": "2025-12-31",
        "capturedAt": "2026-09-18T02:30:10.250285Z",
        "contentHash": "359a78999b0fdbb7354ffe3a2010f15bdaffbbfab006c836512495fcfc46c6f4",
        "excerpt": "总平面图，Master plan",
        "excerptHash": "7c21227cdf185e0e8e95ef1e7482525a7e18f5f249a29c7ef0793d77d7190d54",
        "locator": {
          "kind": "exact-text",
          "text": "总平面图，Master plan"
        }
      },
      {
        "evidenceId": "case-evidence:tianhu-lodge:line-drawing",
        "sourceUrl": "https://www.gooood.cn/tianhu-lake-lodge-reservoir-manag.htm",
        "sourceTitle": "天湖小舍·水库管理房改造",
        "publisher": "谷德设计网；项目资料由成为建筑提供",
        "publishedAt": "2025-12-31",
        "capturedAt": "2026-09-18T02:30:10.250285Z",
        "contentHash": "359a78999b0fdbb7354ffe3a2010f15bdaffbbfab006c836512495fcfc46c6f4",
        "excerpt": "二层平面图，1st floor plan",
        "excerptHash": "71fb0f2fec527377f0e8de26ea9de5f644787bf2d2eea30e850193e948fd27c3",
        "locator": {
          "kind": "exact-text",
          "text": "二层平面图，1st floor plan"
        }
      },
      {
        "evidenceId": "case-evidence:tianhu-lodge:location",
        "sourceUrl": "https://www.gooood.cn/tianhu-lake-lodge-reservoir-manag.htm",
        "sourceTitle": "天湖小舍·水库管理房改造",
        "publisher": "谷德设计网；项目资料由成为建筑提供",
        "publishedAt": "2025-12-31",
        "capturedAt": "2026-09-18T02:30:10.250285Z",
        "contentHash": "359a78999b0fdbb7354ffe3a2010f15bdaffbbfab006c836512495fcfc46c6f4",
        "excerpt": "天湖小舍位于福建省福鼎市嵛山岛天湖核心景区，由原水库管理房旧址上改建而成，景色绝佳，临湖而立，湖对面是连绵的白茶茶园和海上草场。",
        "excerptHash": "70a188d308428fd6f098abb3df079fe99ec285836df6369fb17d528ca9cc52e6",
        "locator": {
          "kind": "exact-text",
          "text": "天湖小舍位于福建省福鼎市嵛山岛天湖核心景区，由原水库管理房旧址上改建而成，景色绝佳，临湖而立，湖对面是连绵的白茶茶园和海上草场。"
        }
      }
    ],
    "image": {
      "sourceUrl": "https://oss.gooood.cn/uploads/2025/12/055-Tianhu-Lake-Lodge-reservoir-management-building-renovation-by-tobe-Architecture-960x774.jpg",
      "sourcePageUrl": "https://www.gooood.cn/tianhu-lake-lodge-reservoir-manag.htm",
      "width": 960,
      "height": 774,
      "sha256": "56540fd1610e8d345c385f254e8b669c3ed25dbe21fa2da6ed90371ed5e3db7c",
      "mimeType": "image/jpeg",
      "credit": "成为建筑；谷德设计网项目发布页",
      "description": "天湖小舍、临湖前场与相邻道路总平面",
      "imageQuality": {
        "contentKind": "plan",
        "sourceLocation": "福建·福鼎·嵛山岛"
      },
      "analysisScale": "area",
      "mediaPurpose": "area-overview",
      "imageIdentity": {
        "originalId": "sha256:56540fd1610e8d345c385f254e8b669c3ed25dbe21fa2da6ed90371ed5e3db7c",
        "fileSha256": "56540fd1610e8d345c385f254e8b669c3ed25dbe21fa2da6ed90371ed5e3db7c",
        "verification": "file-hash"
      },
      "locationEvidenceIds": [
        "case-evidence:tianhu-lodge:location"
      ]
    },
    "analysis": [
      {
        "focus": "site",
        "title": "面｜库岸服务节点",
        "claim": "以256平方米管理房改造承接环湖游线的抵达与停留。",
        "body": [
          "福建福鼎嵛山岛，天湖小舍由原水库管理房改造，建筑面积256平方米，临湖而立，对岸是白茶茶园和草场。",
          "总平面保留建筑、相邻道路和湖岸的关系。节点位于游客下车点，为2.5公里环湖旅游线补入休憩和茶咖空间。"
        ],
        "evidenceIds": [
          "case-evidence:tianhu-lodge:site",
          "case-evidence:tianhu-lodge:scale",
          "case-evidence:tianhu-lodge:route",
          "case-evidence:tianhu-lodge:area-drawing"
        ],
        "scales": [
          "area"
        ]
      },
      {
        "focus": "experience",
        "title": "点｜休憩与茶咖",
        "claim": "保留水库管理功能，同时增加面向游客的停留服务。",
        "body": [
          "一层保留水位、水质监测设备，将其余大部分空间向游客开放，提供休憩、等候和茶咖服务。",
          "二层继续承担工作人员办公与住宿，三层设置湖景茶室。建筑通过功能分层兼顾日常管理与游览需求。"
        ],
        "evidenceIds": [
          "case-evidence:tianhu-lodge:service"
        ],
        "scales": [
          "point"
        ]
      },
      {
        "focus": "organization",
        "title": "线｜管理与游览分流",
        "claim": "将办公流线提前分叉，让公共游览保持连续。",
        "body": [
          "通往二层办公区的楼梯提前分叉，与游客通往三层茶室的路径分开，形成清楚的公共与内部通行关系。",
          "回收瓦片墙遮蔽办公走廊，同时保留采光和通风。界面与流线共同维护管理空间的独立性。"
        ],
        "evidenceIds": [
          "case-evidence:tianhu-lodge:circulation",
          "case-evidence:tianhu-lodge:screen",
          "case-evidence:tianhu-lodge:service"
        ],
        "scales": [
          "line"
        ]
      }
    ],
    "gallery": [
      {
        "imageId": "site",
        "sourceUrl": "https://oss.gooood.cn/uploads/2025/12/055-Tianhu-Lake-Lodge-reservoir-management-building-renovation-by-tobe-Architecture-960x774.jpg",
        "sourcePageUrl": "https://www.gooood.cn/tianhu-lake-lodge-reservoir-manag.htm",
        "width": 960,
        "height": 774,
        "sha256": "56540fd1610e8d345c385f254e8b669c3ed25dbe21fa2da6ed90371ed5e3db7c",
        "mimeType": "image/jpeg",
        "credit": "成为建筑；谷德设计网项目发布页",
        "description": "天湖小舍、临湖前场与相邻道路总平面",
        "evidenceIds": [
          "case-evidence:tianhu-lodge:site",
          "case-evidence:tianhu-lodge:scale",
          "case-evidence:tianhu-lodge:area-drawing"
        ],
        "imageQuality": {
          "contentKind": "plan",
          "sourceLocation": "福建·福鼎·嵛山岛"
        },
        "analysisScale": "area",
        "mediaPurpose": "area-overview",
        "imageIdentity": {
          "originalId": "sha256:56540fd1610e8d345c385f254e8b669c3ed25dbe21fa2da6ed90371ed5e3db7c",
          "fileSha256": "56540fd1610e8d345c385f254e8b669c3ed25dbe21fa2da6ed90371ed5e3db7c",
          "verification": "file-hash"
        },
        "locationEvidenceIds": [
          "case-evidence:tianhu-lodge:location"
        ]
      },
      {
        "sourceUrl": "https://oss.gooood.cn/uploads/2025/12/032-Tianhu-Lake-Lodge-reservoir-management-building-renovation-by-tobe-Architecture-960x1440.jpg",
        "width": 960,
        "height": 1440,
        "sha256": "cc279aad8e73f642de27165f782507b01cb73d99afcb08d32c4054f55fc0b6ea",
        "mimeType": "image/jpeg",
        "sourcePageUrl": "https://www.gooood.cn/tianhu-lake-lodge-reservoir-manag.htm",
        "credit": "存在建筑 Arch-Exist；成为建筑供稿／谷德设计网",
        "description": "面向湖景的茶咖座席",
        "imageId": "experience",
        "evidenceIds": [
          "case-evidence:tianhu-lodge:service"
        ],
        "analysisScale": "point",
        "mediaPurpose": "representative-point",
        "imageIdentity": {
          "originalId": "sha256:cc279aad8e73f642de27165f782507b01cb73d99afcb08d32c4054f55fc0b6ea",
          "fileSha256": "cc279aad8e73f642de27165f782507b01cb73d99afcb08d32c4054f55fc0b6ea",
          "verification": "file-hash"
        },
        "imageQuality": {
          "contentKind": "photo",
          "sourceLocation": "福建·福鼎·嵛山岛"
        },
        "locationEvidenceIds": [
          "case-evidence:tianhu-lodge:location"
        ]
      },
      {
        "imageId": "organization",
        "sourceUrl": "https://oss.gooood.cn/uploads/2025/12/047-Tianhu-Lake-Lodge-reservoir-management-building-renovation-by-tobe-Architecture-960x568.jpg",
        "sourcePageUrl": "https://www.gooood.cn/tianhu-lake-lodge-reservoir-manag.htm",
        "width": 960,
        "height": 568,
        "sha256": "503b36e04c4e0f8a212290f33c0d9c2a73b69bdd95cfdd4afd7aca0fe14cf5b6",
        "mimeType": "image/jpeg",
        "credit": "成为建筑；谷德设计网项目发布页",
        "description": "二层平面中的管理区分叉楼梯",
        "evidenceIds": [
          "case-evidence:tianhu-lodge:circulation",
          "case-evidence:tianhu-lodge:service",
          "case-evidence:tianhu-lodge:line-drawing"
        ],
        "imageQuality": {
          "contentKind": "plan",
          "sourceLocation": "福建·福鼎·嵛山岛"
        },
        "analysisScale": "line",
        "mediaPurpose": "circulation",
        "imageIdentity": {
          "originalId": "sha256:503b36e04c4e0f8a212290f33c0d9c2a73b69bdd95cfdd4afd7aca0fe14cf5b6",
          "fileSha256": "503b36e04c4e0f8a212290f33c0d9c2a73b69bdd95cfdd4afd7aca0fe14cf5b6",
          "verification": "file-hash"
        },
        "locationEvidenceIds": [
          "case-evidence:tianhu-lodge:location"
        ]
      },
      {
        "sourceUrl": "https://oss.gooood.cn/uploads/2025/12/041-Tianhu-Lake-Lodge-reservoir-management-building-renovation-by-tobe-Architecture-960x720.jpg",
        "width": 960,
        "height": 720,
        "sha256": "e4132e02408b4cabcfe0f07eb964853b173f703f2efe5f61645c37a57085d872",
        "mimeType": "image/jpeg",
        "sourcePageUrl": "https://www.gooood.cn/tianhu-lake-lodge-reservoir-manag.htm",
        "credit": "存在建筑 Arch-Exist；成为建筑供稿／谷德设计网",
        "description": "游客进入建筑的公共前场",
        "imageId": "application",
        "evidenceIds": [
          "case-evidence:tianhu-lodge:route",
          "case-evidence:tianhu-lodge:service"
        ],
        "analysisScale": "point",
        "mediaPurpose": "application",
        "imageIdentity": {
          "originalId": "sha256:e4132e02408b4cabcfe0f07eb964853b173f703f2efe5f61645c37a57085d872",
          "fileSha256": "e4132e02408b4cabcfe0f07eb964853b173f703f2efe5f61645c37a57085d872",
          "verification": "file-hash"
        },
        "imageQuality": {
          "contentKind": "photo",
          "sourceLocation": "福建·福鼎·嵛山岛"
        },
        "locationEvidenceIds": [
          "case-evidence:tianhu-lodge:location"
        ]
      }
    ],
    "spatial": {
      "scope": {
        "kind": "building-site",
        "statement": "建筑面积256平方米的水库管理房改造及相邻临湖场地，接续2.5公里环湖游线。",
        "evidenceIds": [
          "case-evidence:tianhu-lodge:scale",
          "case-evidence:tianhu-lodge:site",
          "case-evidence:tianhu-lodge:route"
        ],
        "measurements": [
          {
            "label": "建筑面积",
            "value": 256,
            "unit": "m2",
            "evidenceIds": [
              "case-evidence:tianhu-lodge:scale"
            ]
          }
        ]
      },
      "area": {
        "evidenceIds": [
          "case-evidence:tianhu-lodge:site",
          "case-evidence:tianhu-lodge:scale",
          "case-evidence:tianhu-lodge:area-drawing"
        ],
        "imageIds": [
          "site"
        ]
      },
      "line": {
        "evidenceIds": [
          "case-evidence:tianhu-lodge:route",
          "case-evidence:tianhu-lodge:circulation",
          "case-evidence:tianhu-lodge:service",
          "case-evidence:tianhu-lodge:line-drawing"
        ],
        "imageIds": [
          "organization"
        ],
        "routes": [
          {
            "mode": "arrival",
            "claim": "游客抵达原管理房下车点，进入环湖游线的室内休憩节点。",
            "evidenceIds": [
              "case-evidence:tianhu-lodge:route"
            ],
            "sourceQuote": "水库管理房原址恰好位于游客来到天湖景区的下车点，所以改造是难得的机会，可以在2.5公里的环湖旅游路线上为游客设置一个室内的休息空间，并且创造一个人与湖互动和对话的全新场景。"
          },
          {
            "mode": "visitor",
            "claim": "游客沿楼梯前往三层湖景茶室。",
            "evidenceIds": [
              "case-evidence:tianhu-lodge:circulation"
            ],
            "sourceQuote": "在交通流线上，我们将通往二层办公的楼梯段提前分叉，使其在游客通往三层的路径中消隐。"
          },
          {
            "mode": "service",
            "claim": "二层办公通路在楼梯段提前分叉。",
            "evidenceIds": [
              "case-evidence:tianhu-lodge:circulation"
            ],
            "sourceQuote": "在交通流线上，我们将通往二层办公的楼梯段提前分叉，使其在游客通往三层的路径中消隐。"
          }
        ]
      },
      "point": {
        "evidenceIds": [
          "case-evidence:tianhu-lodge:service"
        ],
        "imageIds": [
          "experience"
        ]
      },
      "sourceGaps": [
        {
          "scale": "line",
          "mode": "vehicle",
          "reason": "来源确认游客下车点，未给出外围车行线路及停车组织。",
          "blocking": false
        }
      ]
    }
  },
  {
    "caseId": "xiangshan",
    "name": "日月潭向山段自行车道",
    "location": "台湾·南投·鱼池",
    "delivery": {
      "status": "operating",
      "proof": "current-opening-hours",
      "evidenceIds": [
        "case-evidence:xiangshan:built"
      ]
    },
    "summary": "向山段连接水社与向山游客中心，沿线组织滨水骑行、步行桥和湖岸休憩，两端配套自行车租赁。",
    "lesson": "以连续慢行串联湖岸，以节点服务支撑游览。",
    "features": [
      {
        "id": "slow-travel",
        "dimension": "scene",
        "label": "连续慢行",
        "fact": "向山段连接两处旅游节点，步行和骑行在桥段分流。",
        "evidenceIds": [
          "case-evidence:xiangshan:separation"
        ],
        "application": "先组织连续慢行，再在交汇节点处理步行与骑行关系。"
      },
      {
        "id": "waterfront",
        "dimension": "environment",
        "label": "滨水景观",
        "fact": "一段滨水自行车道沿水面架设，串联湖岸景观。",
        "evidenceIds": [
          "case-evidence:xiangshan:waterfront"
        ],
        "application": "利用已有可达岸段组织看水体验与停留。"
      },
      {
        "id": "visitor-service",
        "dimension": "function",
        "label": "节点服务",
        "fact": "水社和向山游客中心两端提供自行车租赁。",
        "evidenceIds": [
          "case-evidence:xiangshan:route"
        ],
        "application": "将服务配置在游线起终点和主要转换节点。"
      }
    ],
    "boundary": {
      "fact": "向山段包含约400米架设于水面之上的车道。",
      "applicationLimit": "可借鉴连续性与人车组织，水上结构不直接套用于本项目。",
      "evidenceIds": [
        "case-evidence:xiangshan:waterfront"
      ]
    },
    "evidence": [
      {
        "evidenceId": "case-evidence:xiangshan:built",
        "sourceUrl": "https://www.sunmoonlake.gov.tw/en/attractions/Attractions?A=20&Id=18",
        "sourceTitle": "日月潭向山段自行车道",
        "publisher": "日月潭国家风景区管理处",
        "publishedAt": null,
        "capturedAt": "2026-09-18T02:29:57.802843Z",
        "contentHash": "73991ee09859c7e3dbce8ac09e8e0c3620bdbe9317d57bc6dd7df5e570f4da06",
        "excerpt": "Opening Hours : 09:00-17:00, open year-round. Temporary closures (due to natural disasters or maintenance) will be announced in Construction Notices.",
        "excerptHash": "3885fd6386123367740127a4fa095573a69f800f472af5eb72653e850b047195",
        "locator": {
          "kind": "exact-text",
          "text": "Opening Hours : 09:00-17:00, open year-round. Temporary closures (due to natural disasters or maintenance) will be announced in Construction Notices."
        }
      },
      {
        "evidenceId": "case-evidence:xiangshan:route",
        "sourceUrl": "https://www.sunmoonlake.gov.tw/en/attractions/Attractions?A=20&Id=18",
        "sourceTitle": "日月潭向山段自行车道",
        "publisher": "日月潭国家风景区管理处",
        "publishedAt": null,
        "capturedAt": "2026-09-18T02:29:57.802843Z",
        "contentHash": "73991ee09859c7e3dbce8ac09e8e0c3620bdbe9317d57bc6dd7df5e570f4da06",
        "excerpt": "The Sun Moon Lake Bikeway is about 6.4km in total, and the 3-km Xiangshan Section refers to the part between two important tourist attractions, Shuishe and Xiangshan Visitor Center. Both attractions provide bicycle rentals.",
        "excerptHash": "4d575d574e74d1df206b96d5dbf3e101ed782a2616d72974cf1d95f2dc7eb7b7",
        "locator": {
          "kind": "exact-text",
          "text": "The Sun Moon Lake Bikeway is about 6.4km in total, and the 3-km Xiangshan Section refers to the part between two important tourist attractions, Shuishe and Xiangshan Visitor Center. Both attractions provide bicycle rentals."
        }
      },
      {
        "evidenceId": "case-evidence:xiangshan:waterfront",
        "sourceUrl": "https://www.sunmoonlake.gov.tw/en/attractions/Attractions?A=20&Id=18",
        "sourceTitle": "日月潭向山段自行车道",
        "publisher": "日月潭国家风景区管理处",
        "publishedAt": null,
        "capturedAt": "2026-09-18T02:29:57.802843Z",
        "contentHash": "73991ee09859c7e3dbce8ac09e8e0c3620bdbe9317d57bc6dd7df5e570f4da06",
        "excerpt": "There is even a 400m sub-section that's built right above water surface away from houses and shops - it is called the “waterfront bikeway.”",
        "excerptHash": "7f338aef639d6cb49f6c053206ef3d218f6472fedfd5922017f5c60d36ff0402",
        "locator": {
          "kind": "exact-text",
          "text": "There is even a 400m sub-section that's built right above water surface away from houses and shops - it is called the “waterfront bikeway.”"
        }
      },
      {
        "evidenceId": "case-evidence:xiangshan:separation",
        "sourceUrl": "https://www.sunmoonlake.gov.tw/en/attractions/Attractions?A=20&Id=18",
        "sourceTitle": "日月潭向山段自行车道",
        "publisher": "日月潭国家风景区管理处",
        "publishedAt": null,
        "capturedAt": "2026-09-18T02:29:57.802843Z",
        "contentHash": "73991ee09859c7e3dbce8ac09e8e0c3620bdbe9317d57bc6dd7df5e570f4da06",
        "excerpt": "To keep people from bikes in order to stay safe, two bridges (Yongjie and Tongxin) are built, respectively for cyclists and pedestrians.",
        "excerptHash": "b9276d42fb3c32cdc20037a71882d033c46f95dbee3b2aada27f97101dabd639",
        "locator": {
          "kind": "exact-text",
          "text": "To keep people from bikes in order to stay safe, two bridges (Yongjie and Tongxin) are built, respectively for cyclists and pedestrians."
        }
      },
      {
        "evidenceId": "case-evidence:xiangshan:area-map",
        "sourceUrl": "https://theme.sunmoonlake.gov.tw/ComeBikeDay/FullPage.aspx?a=324&l=1",
        "sourceTitle": "日月潭向山段自行车道",
        "publisher": "日月潭国家风景区管理处",
        "publishedAt": null,
        "capturedAt": "2026-09-19T06:29:15.840622+00:00",
        "contentHash": "a432683950894f178f4252a7ec43926cb8610a7328b4e59141cd7699c6073942",
        "excerpt": "02向山段",
        "excerptHash": "d2d8d863f5c0ef2eeea2b2ba446d02a91f202d67647abbd5352d0c2833b0d836",
        "locator": {
          "kind": "exact-text",
          "text": "02向山段"
        }
      },
      {
        "evidenceId": "case-evidence:xiangshan:official-route",
        "sourceUrl": "https://theme.sunmoonlake.gov.tw/ComeBikeDay/FullPage.aspx?a=324&l=1",
        "sourceTitle": "日月潭向山段自行车道",
        "publisher": "日月潭国家风景区管理处",
        "publishedAt": null,
        "capturedAt": "2026-09-19T06:29:15.840622+00:00",
        "contentHash": "a432683950894f178f4252a7ec43926cb8610a7328b4e59141cd7699c6073942",
        "excerpt": "曾被CNN評比為「世界十大最美自行車道」之一的向山段，也是最熱門的自行車道，平緩的路線連結水社到向山遊客中心，適合休閒慢騎，其中更有一段400公尺長的「水上自行車道」架空在潭水之上，沿著日月潭而行，體驗悠哉的日月潭風光。",
        "excerptHash": "89b3575a1752c101fc159579ae8a957acec9a31d3bc3791d0631356d58a6a4a8",
        "locator": {
          "kind": "exact-text",
          "text": "曾被CNN評比為「世界十大最美自行車道」之一的向山段，也是最熱門的自行車道，平緩的路線連結水社到向山遊客中心，適合休閒慢騎，其中更有一段400公尺長的「水上自行車道」架空在潭水之上，沿著日月潭而行，體驗悠哉的日月潭風光。"
        }
      },
      {
        "evidenceId": "case-evidence:xiangshan:location",
        "sourceUrl": "https://www.sunmoonlake.gov.tw/en/attractions/Attractions?A=20&Id=18",
        "sourceTitle": "日月潭向山段自行车道",
        "publisher": "日月潭国家风景区管理处",
        "publishedAt": null,
        "capturedAt": "2026-09-18T02:29:57.802843Z",
        "contentHash": "73991ee09859c7e3dbce8ac09e8e0c3620bdbe9317d57bc6dd7df5e570f4da06",
        "excerpt": "Address : Zhongshan Rd, Yuchi Township, Nantou County",
        "excerptHash": "2cb029f75b77b6616a43ce0ee4240adbe1363e47d0016dc81a0b2a93958e6d63",
        "locator": {
          "kind": "exact-text",
          "text": "Address : Zhongshan Rd, Yuchi Township, Nantou County"
        }
      }
    ],
    "image": {
      "sourceUrl": "https://theme.sunmoonlake.gov.tw/ComeBikeDay/UserFiles/BicycleBrand/route/02%E5%90%91%E5%B1%B1%E6%AE%B5.png",
      "sourcePageUrl": "https://theme.sunmoonlake.gov.tw/ComeBikeDay/FullPage.aspx?a=324&l=1",
      "width": 963,
      "height": 930,
      "sha256": "ab1093e29cf66001080927b1a201a2909fc7bbf514cab6656a8a73dfbfaa4099",
      "mimeType": "image/png",
      "credit": "日月潭国家风景区管理处官方网站",
      "description": "日月潭西岸向山段及相邻游览分段",
      "imageQuality": {
        "contentKind": "map",
        "sourceLocation": "台湾·南投·鱼池"
      },
      "analysisScale": "area",
      "mediaPurpose": "area-overview",
      "imageIdentity": {
        "originalId": "sha256:ab1093e29cf66001080927b1a201a2909fc7bbf514cab6656a8a73dfbfaa4099",
        "fileSha256": "ab1093e29cf66001080927b1a201a2909fc7bbf514cab6656a8a73dfbfaa4099",
        "verification": "file-hash"
      },
      "locationEvidenceIds": [
        "case-evidence:xiangshan:location"
      ]
    },
    "analysis": [
      {
        "focus": "site",
        "title": "面｜西岸慢行段",
        "claim": "以约 3 公里骑行段连接水社与向山游客中心。",
        "body": [
          "日月潭向山段自行车道连接水社与向山游客中心，两端均提供自行车租赁，为沿湖游览配置明确的起讫点。",
          "向山段约长 3 公里，包含一段约 400 米的水上车道；不同岸线条件共同构成连续的骑行体验。"
        ],
        "evidenceIds": [
          "case-evidence:xiangshan:route",
          "case-evidence:xiangshan:waterfront"
        ],
        "scales": [
          "area"
        ]
      },
      {
        "focus": "experience",
        "title": "点｜沿水骑行",
        "claim": "把连续水景转化为骑行过程中的直接体验。",
        "body": [
          "约 400 米的滨水车道架设在水面上，远离房屋和商铺，使骑行者在行进过程中持续接近湖面。",
          "水社与向山游客中心的租赁服务支撑沿线使用，景观体验与基础服务分别由车道和端点节点承担。"
        ],
        "evidenceIds": [
          "case-evidence:xiangshan:waterfront",
          "case-evidence:xiangshan:route"
        ],
        "scales": [
          "point"
        ]
      },
      {
        "focus": "organization",
        "title": "线｜人车各行其道",
        "claim": "连续骑行与独立步行共同组织湖岸游览。",
        "body": [
          "永结、同心两座桥分别服务自行车与行人，针对不同移动速度安排独立的通行空间。",
          "两端以游客中心和租赁服务形成清晰的游线入口，桥段的人车分流则延续到沿线组织之中。"
        ],
        "evidenceIds": [
          "case-evidence:xiangshan:separation",
          "case-evidence:xiangshan:route"
        ],
        "scales": [
          "line"
        ]
      }
    ],
    "gallery": [
      {
        "imageId": "site",
        "sourceUrl": "https://theme.sunmoonlake.gov.tw/ComeBikeDay/UserFiles/BicycleBrand/route/02%E5%90%91%E5%B1%B1%E6%AE%B5.png",
        "sourcePageUrl": "https://theme.sunmoonlake.gov.tw/ComeBikeDay/FullPage.aspx?a=324&l=1",
        "width": 963,
        "height": 930,
        "sha256": "ab1093e29cf66001080927b1a201a2909fc7bbf514cab6656a8a73dfbfaa4099",
        "mimeType": "image/png",
        "credit": "日月潭国家风景区管理处官方网站",
        "description": "日月潭西岸向山段及相邻游览分段",
        "evidenceIds": [
          "case-evidence:xiangshan:route",
          "case-evidence:xiangshan:separation",
          "case-evidence:xiangshan:area-map",
          "case-evidence:xiangshan:official-route"
        ],
        "imageQuality": {
          "contentKind": "map",
          "sourceLocation": "台湾·南投·鱼池"
        },
        "analysisScale": "area",
        "mediaPurpose": "area-overview",
        "imageIdentity": {
          "originalId": "sha256:ab1093e29cf66001080927b1a201a2909fc7bbf514cab6656a8a73dfbfaa4099",
          "fileSha256": "ab1093e29cf66001080927b1a201a2909fc7bbf514cab6656a8a73dfbfaa4099",
          "verification": "file-hash"
        },
        "locationEvidenceIds": [
          "case-evidence:xiangshan:location"
        ]
      },
      {
        "sourceUrl": "https://www.sunmoonlake.gov.tw/fapi/Image?type=Attraction&id=91&refid=18&l=2&w=2480&h=1488",
        "width": 2000,
        "height": 1333,
        "sha256": "8b75721359c13b61331f81eea4f1ea185d214d7150bdfbebad0b126ffd03cb01",
        "mimeType": "image/jpeg",
        "sourcePageUrl": "https://www.sunmoonlake.gov.tw/en/attractions/Attractions?A=20&Id=18",
        "credit": "日月潭国家风景区管理处官方网站",
        "description": "游客沿水骑行",
        "imageId": "experience",
        "evidenceIds": [
          "case-evidence:xiangshan:waterfront"
        ],
        "analysisScale": "point",
        "mediaPurpose": "representative-point",
        "imageIdentity": {
          "originalId": "sha256:8b75721359c13b61331f81eea4f1ea185d214d7150bdfbebad0b126ffd03cb01",
          "fileSha256": "8b75721359c13b61331f81eea4f1ea185d214d7150bdfbebad0b126ffd03cb01",
          "verification": "file-hash"
        },
        "imageQuality": {
          "contentKind": "photo",
          "sourceLocation": "台湾·南投·鱼池"
        },
        "locationEvidenceIds": [
          "case-evidence:xiangshan:location"
        ]
      },
      {
        "imageId": "organization",
        "sourceUrl": "https://theme.sunmoonlake.gov.tw/ComeBikeDay/UserFiles/BicycleBrand/route/02%E5%90%91%E5%B1%B1%E6%AE%B5.png",
        "sourcePageUrl": "https://theme.sunmoonlake.gov.tw/ComeBikeDay/FullPage.aspx?a=324&l=1",
        "width": 963,
        "height": 930,
        "sha256": "ab1093e29cf66001080927b1a201a2909fc7bbf514cab6656a8a73dfbfaa4099",
        "mimeType": "image/png",
        "credit": "日月潭国家风景区管理处官方网站",
        "description": "向山段慢行线路、桥段与沿线提示",
        "evidenceIds": [
          "case-evidence:xiangshan:route",
          "case-evidence:xiangshan:separation",
          "case-evidence:xiangshan:area-map",
          "case-evidence:xiangshan:official-route"
        ],
        "imageQuality": {
          "contentKind": "map",
          "sourceLocation": "台湾·南投·鱼池"
        },
        "analysisScale": "line",
        "mediaPurpose": "circulation",
        "imageIdentity": {
          "originalId": "sha256:ab1093e29cf66001080927b1a201a2909fc7bbf514cab6656a8a73dfbfaa4099",
          "fileSha256": "ab1093e29cf66001080927b1a201a2909fc7bbf514cab6656a8a73dfbfaa4099",
          "verification": "file-hash"
        },
        "locationEvidenceIds": [
          "case-evidence:xiangshan:location"
        ]
      },
      {
        "sourceUrl": "https://www.sunmoonlake.gov.tw/fapi/Image?type=Attraction&id=92&refid=18&l=2&w=2480&h=1488",
        "width": 2232,
        "height": 1488,
        "sha256": "548b2df4e56d842547277fbb607c89887e5e8d34e8e967332aa590cff2be229b",
        "mimeType": "image/jpeg",
        "sourcePageUrl": "https://www.sunmoonlake.gov.tw/en/attractions/Attractions?A=20&Id=18",
        "credit": "日月潭国家风景区管理处官方网站",
        "description": "湖岸车道的连续转折与景观",
        "imageId": "application",
        "evidenceIds": [
          "case-evidence:xiangshan:route",
          "case-evidence:xiangshan:waterfront"
        ],
        "analysisScale": "point",
        "mediaPurpose": "application",
        "imageIdentity": {
          "originalId": "sha256:548b2df4e56d842547277fbb607c89887e5e8d34e8e967332aa590cff2be229b",
          "fileSha256": "548b2df4e56d842547277fbb607c89887e5e8d34e8e967332aa590cff2be229b",
          "verification": "file-hash"
        },
        "imageQuality": {
          "contentKind": "photo",
          "sourceLocation": "台湾·南投·鱼池"
        },
        "locationEvidenceIds": [
          "case-evidence:xiangshan:location"
        ]
      }
    ],
    "spatial": {
      "scope": {
        "kind": "landscape-route",
        "statement": "水社至向山游客中心之间约3公里的向山段自行车道。",
        "evidenceIds": [
          "case-evidence:xiangshan:route",
          "case-evidence:xiangshan:official-route"
        ],
        "measurements": [
          {
            "label": "向山段长度",
            "value": 3,
            "unit": "km",
            "evidenceIds": [
              "case-evidence:xiangshan:route"
            ]
          }
        ]
      },
      "area": {
        "evidenceIds": [
          "case-evidence:xiangshan:route",
          "case-evidence:xiangshan:area-map"
        ],
        "imageIds": [
          "site"
        ]
      },
      "line": {
        "evidenceIds": [
          "case-evidence:xiangshan:route",
          "case-evidence:xiangshan:separation",
          "case-evidence:xiangshan:area-map",
          "case-evidence:xiangshan:official-route"
        ],
        "imageIds": [
          "organization"
        ],
        "routes": [
          {
            "mode": "arrival",
            "claim": "水社与向山游客中心为游线两端，均配置自行车租赁。",
            "evidenceIds": [
              "case-evidence:xiangshan:route"
            ],
            "sourceQuote": "The Sun Moon Lake Bikeway is about 6.4km in total, and the 3-km Xiangshan Section refers to the part between two important tourist attractions, Shuishe and Xiangshan Visitor Center. Both attractions provide bicycle rentals."
          },
          {
            "mode": "visitor",
            "claim": "桥段按步行与骑行分流。",
            "evidenceIds": [
              "case-evidence:xiangshan:separation"
            ],
            "sourceQuote": "To keep people from bikes in order to stay safe, two bridges (Yongjie and Tongxin) are built, respectively for cyclists and pedestrians."
          }
        ]
      },
      "point": {
        "evidenceIds": [
          "case-evidence:xiangshan:waterfront"
        ],
        "imageIds": [
          "experience"
        ]
      },
      "sourceGaps": [
        {
          "scale": "line",
          "mode": "vehicle",
          "reason": "向山段资料未交代机动车接驳和停车流线。",
          "blocking": false
        },
        {
          "scale": "line",
          "mode": "service",
          "reason": "公开导览资料未交代维修或后勤服务路线。",
          "blocking": false
        }
      ]
    }
  }
]
