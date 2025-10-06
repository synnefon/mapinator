export enum Language {
    ROMANCE = "ROMANCE",
    GERMANIC = "GERMANIC",
    TURKIC = "TURKIC",
    SEMITIC = "SEMITIC",
    BANTU_LIKE = "BANTU_LIKE",
    AFRICAN_WEST = "AFRICAN_WEST",
    AFRICAN_HORN = "AFRICAN_HORN",
    EAST_ASIAN_CN = "EAST_ASIAN_CN",
    EAST_ASIAN_JP = "EAST_ASIAN_JP",
    POLYNESIAN = "POLYNESIAN",
    MONGOLIC = "MONGOLIC",
    GREEKIC = "GREEKIC",
    LATINIC = "LATINIC",
    CELESTIC = "CELESTIC",
    INFERNIC = "INFERNIC",
    ARCANE = "ARCANE",
    DEEP_SPEECH = "DEEP_SPEECH",
    GOBLINIC = "GOBLINIC",
    TECHNARCH = "TECHNARCH",
    INFERNO = "INFERNO",
    SIRENIC = "SIRENIC",
};

type LanguageConfig = {
    onsets: string[];
    vowels: string[];
    codas: string[];
    codaChance: number;          // likelihood of adding a coda after a vowel
    medials: string[];           // not used yet, but handy for later flavor
    medialMorphChance: number;   // ^
    suffixes: string[]
};

// A few reusable vowel bundles to bias families
const V_OPEN = ["a", "e", "i", "o", "u"];
const V_DIP = ["ai", "au", "ei", "ia", "io", "oa", "ue", "ui"];
const V_SOFT = ["a", "e", "i", "o", "u", "ia", "io", "ie", "ea"];
const V_SEMI = ["a", "i", "u", "aa", "ii", "uu", "ai", "au"];

export const languageConfigs: { [key: string]: LanguageConfig } = {
    [Language.ROMANCE]: {
        onsets: ["b", "c", "d", "f", "g", "l", "m", "n", "p", "r", "s", "t",
            "br", "cr", "dr", "fl", "gl", "gr", "pr", "tr", "vr"],
        vowels: [...V_SOFT, "oa", "ue", "eo"],
        codas: ["n", "r", "s", "l", "m"],
        codaChance: 0.45,
        medials: ["del", "dor", "ver", "mar", "val", "lor", "ria", "lia", "mia"],
        medialMorphChance: 0.45,
        suffixes: ["ia", "aria", "esia", "orio", "io", "a", "o", "es"],
    },
    [Language.GERMANIC]: {
        onsets: ["b", "d", "f", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "w", "th",
            "br", "cr", "dr", "fr", "gr", "kr", "pr", "tr", "st", "sk", "sp"],
        vowels: [...V_OPEN, ...V_DIP],
        codas: ["nd", "rt", "rm", "rg", "lf", "rk", "lt", "st", "sk", "n", "r", "m", "l", "k"],
        codaChance: 0.65,
        medials: ["wald", "heim", "mark", "gard", "dorf"],
        medialMorphChance: 0.30,
        suffixes: ["land", "heim", "berg"],
    },
    [Language.SEMITIC]: {
        onsets: ["al", "ar", "as", "bal", "dar", "qal", "mal", "ram", "sam", "zar", "bar", "sar"],
        vowels: [...V_SEMI],
        codas: ["n", "m", "r", "l", "s", "h"],
        codaChance: 0.50,
        medials: ["har", "sar", "ram", "bar"],
        medialMorphChance: 0.35,
        suffixes: ["ia", "aya", "iyya"],
    },
    [Language.AFRICAN_WEST]: {
        onsets: [
            "a", "ba", "da", "ka", "fa", "ga", "la", "ma", "na", "oba", "ola", "ade",
            "kw", "gb", "ch", "ny", "eke", "oba", "ife", "olu"
        ],
        vowels: ["a", "e", "i", "o", "u", "ai", "oa", "ie", "ua"],
        codas: ["n", "m", "wa", "ra", ""],
        codaChance: 0.35,
        medials: ["loba", "femi", "kwe", "tunde", "chukwu", "nwa", "kofi", "yemi"],
        medialMorphChance: 0.50,
        suffixes: ["la", "ba", "ra", "ni", "do", "ma"],
    },
    [Language.AFRICAN_HORN]: {
        onsets: [
            "ab", "ad", "as", "ba", "da", "ha", "ka", "ma", "na", "sa", "ra", "ta",
            "gez", "tes", "hab", "sel", "mer", "zer", "yon", "lem"
        ],
        vowels: ["a", "e", "i", "o", "u", "aa", "ee", "ei", "ia", "ua"],
        codas: ["s", "m", "n", "l", "t", ""],
        codaChance: 0.45,
        medials: ["sel", "geb", "tek", "yon", "hab", "mar", "zer", "wold"],
        medialMorphChance: 0.50,
        suffixes: ["el", "es", "os", "on", "u"],
    },
    [Language.EAST_ASIAN_CN]: {
        onsets: [
            "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h",
            "zh", "ch", "sh", "r", "z", "c", "s"
        ],
        vowels: [
            "a", "o", "e", "i", "u", "ü",
            "ai", "ei", "ao", "ou", "ia", "ie", "iao", "iu", "ua", "uo", "ui", "üe", "er"
        ],
        codas: ["n", "ng", ""],
        codaChance: 0.40,
        medials: ["shan", "jiang", "he", "hu", "zhou", "dao", "lin", "yang", "qing", "jing", "guo", "cheng"],
        medialMorphChance: 0.35,
        suffixes: ["shan", "dao", "zhou", "guo", "cheng", "men"],
    },

    [Language.EAST_ASIAN_JP]: {
        onsets: [
            "k", "s", "t", "n", "h", "m", "y", "r", "w",
            "g", "z", "d", "b", "p",
            "ky", "sh", "ch", "ny", "hy", "my", "ry", "gy", "j", "py"
        ],
        vowels: ["a", "i", "u", "e", "o"],
        codas: ["", "n"],
        codaChance: 0.35,
        medials: ["mori", "yama", "kawa", "gawa", "shima", "jima", "saka", "hara", "tani"],
        medialMorphChance: 0.30,
        suffixes: ["to", "ken", "do", "fu", "shi", "mura"],
    },
    [Language.POLYNESIAN]: {
        // allow vowel-initial names; Polynesian loves CV / V syllables
        onsets: [
            "", "h", "k", "l", "m", "n", "p", "r", "t", "w",
            "wh", "ng" // Māori-style digraphs (keep if you like that flavor)
        ],
        // favor pure vowels & gentle diphthongs; add macrons if allowDiacritics
        vowels: ["a", "e", "i", "o", "u"],
        codas: ["", "’", "ʻ"],
        codaChance: 0.2,
        medials: [
            "moa", "rangi", "tonga", "tai", "wai", "puna", "tapu", "mana",
            "ariki", "tiki", "honu", "pua", "mata", "ika", "koro", "hale", "fale", "nui", "loa", "roa"
        ],
        medialMorphChance: 0.30,
        suffixes: ["nui", "roa", "loa", "rangi", "moana", "tonga", "tai", "puna"],
    },
    [Language.LATINIC]: {
        onsets: [
            "a", "e", "i", "o", "u",
            "b", "c", "d", "f", "g", "l", "m", "n", "p", "r", "s", "t", "v",
            "cl", "fl", "gl", "pr", "tr", "cr", "pl", "fr", "gr", "dr", "qu"
        ],
        vowels: ["a", "e", "i", "o", "u", "ae", "oe", "au", "ia", "io", "ua", "uo"],
        codas: ["s", "n", "r", "m", "t", "l", "us", "um", "a"],
        codaChance: 0.55,
        medials: [
            "dom", "val", "magn", "clar", "fort", "sanct", "imper", "aure", "vit", "cel", "luc", "reg", "mart"
        ],
        medialMorphChance: 0.50,
        suffixes: [
            "us", "um", "a", "or", "is", "ianus", "ensis", "atus", "itas", "arium", "arium"
        ],
    },
    [Language.MONGOLIC]: {
        onsets: [
            "ba", "bo", "bu", "ta", "to", "tu", "ga", "go", "gu", "da", "do", "du",
            "kha", "kh", "qar", "gur", "dar", "bor", "nar", "sar", "bat", "alt"
        ],
        vowels: ["a", "e", "i", "o", "u", "ai", "oi", "ua", "uu"],
        codas: ["n", "r", "g", "t", "s", ""],
        codaChance: 0.50,
        medials: ["bator", "dorj", "suren", "erdene", "tungal", "bayar", "bold", "gan"],
        medialMorphChance: 0.50,
        suffixes: ["bator", "gur", "tengri", "dalai", "khun"],
    },
    [Language.INFERNIC]: {
        onsets: [
            "gr", "kr", "dr", "br", "thr", "vr", "zr", "kl", "sk", "sn", "gn", "vrog", "ulg", "zor", "rak", "gash", "morg"
        ],
        vowels: ["a", "o", "u", "e", "ia", "oa", "ua", "ai", "oi"],
        codas: ["th", "k", "g", "r", "z", "x", "sh", "kh", "gh", "n", "m"],
        codaChance: 0.75,
        medials: ["gor", "zul", "rak", "thr", "khar", "vur", "drak", "mor", "gron", "vul"],
        medialMorphChance: 0.45,
        suffixes: ["oth", "ar", "rak", "gul", "zor", "eth", "uzad", "ash", "ath"],
    },
    [Language.ARCANE]: {
        onsets: [
            "a", "e", "i", "o", "u",
            "x", "z", "v", "q", "k", "s", "r", "th", "sh", "ch", "ph", "gh",
            "xa", "xi", "ze", "zy", "qu", "ka", "ly", "sy", "va", "or", "ny"
        ],
        vowels: ["a", "e", "i", "o", "u", "ae", "ia", "ie", "io", "ei", "ou", "ui"],
        codas: ["n", "r", "s", "th", "x", "z", "sh", "m", "l", "t"],
        codaChance: 0.60,
        medials: ["ar", "en", "is", "os", "ith", "al", "or", "ir", "um", "ex", "ul"],
        medialMorphChance: 0.50,
        suffixes: ["ar", "en", "is", "os", "ith", "or", "ul", "um", "ae", "ion"],
    },

    [Language.CELESTIC]: {
        onsets: [
            "a", "ae", "e", "el", "al", "il", "ol", "ul", "cel", "ser", "ver", "lir", "aur", "eir", "mir", "thal", "val"
        ],
        vowels: ["a", "e", "i", "o", "u", "ae", "ea", "ai", "ia", "ie", "io", "ou", "ui"],
        codas: ["l", "n", "r", "s", "th", "el", "iel", "ar", "is", "as"],
        codaChance: 0.55,
        medials: ["ael", "iel", "ion", "ora", "iel", "ir", "ara", "uri", "arion"],
        medialMorphChance: 0.60,
        suffixes: ["iel", "ael", "ion", "ora", "is", "arion", "iel", "eth"],
    },
    [Language.DEEP_SPEECH]: {
        onsets: [
            "gh", "gr", "kr", "zr", "zh", "xh", "kl", "ql", "k’", "x’", "t’", "sh", "sk", "thl", "vr", "vx", "dl", "rk"
        ],
        vowels: ["a", "u", "o", "e", "ia", "ua", "ao", "ou", ""],
        codas: ["th", "x", "g", "k", "z", "sh", "’th", "’x", "’g", "n"],
        codaChance: 0.80,
        medials: [
            "ul", "gur", "zha", "kth", "rax", "xul", "gath", "urh", "shul", "vrax", "qor", "thrul", "zoth"
        ],
        medialMorphChance: 0.45,
        suffixes: ["’thul", "’gath", "’nax", "’ul", "’rax", "oth", "zoth", "gath", "khul"],
    },
    [Language.GOBLINIC]: {
        onsets: [
            "g", "gr", "kr", "kl", "sn", "sk", "sm", "sp", "st", "tr", "dr", "bl", "br", "pl", "gl", "zz", "gn", "ch", "sc"
        ],
        vowels: ["a", "e", "i", "o", "u", "aa", "oo", "ei", "oi"],
        codas: ["k", "g", "n", "m", "b", "t", "z", "zz", "sh", "p", "x", ""],
        codaChance: 0.70,
        medials: [
            "grub", "snag", "krat", "blit", "skrag", "drub", "gnar", "plok", "zib", "krin", "grot", "snib"
        ],
        medialMorphChance: 0.45,
        suffixes: ["ak", "ig", "ok", "nob", "zit", "gob", "bag", "pik", "nip", "ogg"],
    },
    [Language.INFERNO]: {
        onsets: [
            "f", "ph", "b", "v", "p", "t", "th", "kh", "k", "r", "s", "sh", "ch", "z",
            "br", "kr", "fr", "fl", "dr", "gr", "vr", "zar", "bal", "kal", "ash", "rav", "ign", "py", "flam"
        ],
        vowels: [
            "a", "e", "i", "o", "u",
            "aa", "ae", "ai", "au", "ea", "ei", "io", "oa", "ou", "ua"
        ],
        codas: [
            "r", "s", "th", "x", "z", "n", "m", "sh", "ch", "k", "t", "ar", "az", "eth", "oth"
        ],
        codaChance: 0.70,
        medials: [
            "ash", "zar", "rak", "vyr", "thar", "gor", "ign", "az", "flar", "kesh", "rath", "vor", "pyra"
        ],
        medialMorphChance: 0.45,
        suffixes: [
            "ash", "ur", "zar", "eth", "or", "oth", "ar", "rak", "ath", "zor", "ion"
        ],
    },
    [Language.SIRENIC]: {
        onsets: [
            "a", "e", "i", "o", "u",
            "l", "n", "m", "s", "v", "r", "h", "w",
            "sh", "th", "ph", "ch", "wh", "ly", "ny",
            "sel", "sir", "mar", "nai", "ora", "thal", "vel", "mel", "lun", "aqu", "ond"
        ],
        vowels: [
            "a", "e", "i", "o", "u",
            "ae", "ai", "ea", "ee", "ia", "ie", "io", "oa", "oe", "ou", "ua", "ue", "ui"
        ],
        codas: [
            "n", "r", "l", "s", "th", "sh", "h", "m", "el", "en", "ir", "is", "a", "ia", "ine"
        ],
        codaChance: 0.45,
        medials: [
            "ara", "ela", "ine", "ora", "ula", "iri", "oni", "ari", "una", "esi", "mar", "sel", "vai", "wen", "lua", "nys"
        ],
        medialMorphChance: 0.40,
        suffixes: [
            "ine", "is", "ir", "iel", "ora", "ara", "una", "elle", "en", "ys", "eth", "wen"
        ],
    },

}