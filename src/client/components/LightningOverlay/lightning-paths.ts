export interface LightningPath {
  id: string;
  main: string;
  branches: string[];
  strokeWidth: {
    main: number;
    branch: number;
  };
}

export const VIEWBOX = "0 0 1200 200";

export const LIGHTNING_PATHS: LightningPath[] = [
  {
    id: 'bolt-alpha',
    main: 'M 150,0 L 145,18 L 158,22 L 148,45 L 162,50 L 152,78 L 168,85 L 155,115 L 172,122 L 158,155 L 175,165 L 160,195',
    branches: [
      'M 148,45 L 132,58 L 125,75',
      'M 152,78 L 175,92 L 182,108',
      'M 158,155 L 140,168 L 132,185',
    ],
    strokeWidth: { main: 2.5, branch: 1.6 },
  },
  {
    id: 'bolt-beta',
    main: 'M 420,0 L 428,15 L 415,20 L 432,42 L 418,48 L 438,75 L 422,82 L 442,112 L 425,120 L 448,152 L 430,162 L 455,198',
    branches: [
      'M 432,42 L 452,55 L 465,72',
      'M 422,82 L 398,95 L 385,115',
      'M 448,152 L 468,165 L 478,182',
    ],
    strokeWidth: { main: 2.8, branch: 1.8 },
  },
  {
    id: 'bolt-gamma',
    main: 'M 720,0 L 715,12 L 728,18 L 712,38 L 725,45 L 708,68 L 722,75 L 705,98 L 720,108 L 702,135 L 718,145 L 700,178 L 715,188',
    branches: [
      'M 712,38 L 695,48 L 682,65',
      'M 708,68 L 738,82 L 752,98',
      'M 702,135 L 680,148 L 668,168',
    ],
    strokeWidth: { main: 2.2, branch: 1.4 },
  },
  {
    id: 'bolt-delta',
    main: 'M 980,0 L 988,20 L 975,28 L 992,52 L 978,60 L 998,88 L 982,98 L 1005,128 L 988,138 L 1012,168 L 995,178 L 1018,198',
    branches: [
      'M 992,52 L 1015,65 L 1028,82',
      'M 982,98 L 958,112 L 942,130',
      'M 1012,168 L 1035,180 L 1048,195',
    ],
    strokeWidth: { main: 2.6, branch: 1.7 },
  },
];
