export enum Language {
    ROMANCE = "ROMANCE",
    GERMANIC = "GERMANIC",
    TURKIC = "TURKIC",
    SEMITIC = "SEMITIC",
    BANTU_LIKE = "BANTU_LIKE",
    AFRICAN_WEST = "AFRICAN_WEST",
    AFRICAN_HORN = "AFRICAN_HORN",
    CN = "CN",
    JP = "JP",
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
    OOGA_BOOGA = "OOGA_BOOGA",
    DWARVISH = "DWARVISH",
    HALFLING = "HALFLING",
    NOCTURNIC = "NOCTURNIC",
    DERPTONGUE = "DERPTONGUE",
    TOADISH = "TOADISH",
    BANANAIC = "BANANAIC",
    LYRICIAN = "LYRICIAN",
    ANGLISHIC = "ANGLISHIC",
    NEW_ANGLISHIC = "NEW_ANGLISHIC",
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
    [Language.CN]: {
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

    [Language.JP]: {
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
    [Language.OOGA_BOOGA]: {
        onsets: ["", "b", "g", "k", "m", "n", "t", "p", "w", "h", "bg", "gb", "gr", "kr"],
        vowels: ["o", "a", "u", "oo", "oa", "ou", "ua", "uga", "oga"],
        codas: ["", "g", "k", "ng", "ga", "ka", "gk"],
        codaChance: 0.72,
        medials: ["ooga", "booga", "boga", "maka", "taka", "gora", "gugu", "koko", "boko"],
        medialMorphChance: 0.35,
        suffixes: ["uga", "booga", "g", "ka", "ko", "ga", "bog", "ok"],
    },
    [Language.DWARVISH]: {
        onsets: ["b", "d", "g", "k", "m", "n", "r", "t", "v", "z", "br", "dr", "gr", "kr", "tr", "thr", "kh"],
        vowels: ["a", "e", "i", "o", "u", "ai", "oi", "au"],
        codas: ["r", "n", "m", "k", "g", "d", "nd", "rd", "ld", "rn", "rm", "rg", "rk"],
        codaChance: 0.75,
        medials: ["dur", "grim", "bar", "kar", "grom", "thal", "dun", "fund", "brak", "stenn", "stein"],
        medialMorphChance: 0.45,
        suffixes: ["in", "ar", "orn", "grin", "dun", "hald", "heim", "hold"],
    },
    [Language.HALFLING]: {
        onsets: ["b", "d", "f", "g", "h", "j", "k", "l", "m", "n", "p", "r", "s", "t", "w", "br", "cl", "fl", "pl", "wh"],
        vowels: ["a", "e", "i", "o", "u", "ie", "ea", "ai", "oa", "oi", "oo"],
        codas: ["n", "r", "l", "m", "s", "t", "ck", "nd", "rt", "ft", "ley", "ton"],
        codaChance: 0.55,
        medials: ["apple", "bur", "brook", "dale", "mill", "merry", "will", "hedge", "bottle", "puddle"],
        medialMorphChance: 0.30,
        suffixes: ["ton", "ford", "wick", "brook", "hill", "bury", "shaw", "combe", "ley"],
    },
    [Language.NOCTURNIC]: {
        onsets: ["v", "s", "z", "r", "l", "m", "n", "d", "t", "c", "ch", "sh", "vr", "cr", "dr", "str"],
        vowels: ["a", "e", "i", "o", "u", "ae", "ei", "ia", "io", "ou", "ui"],
        codas: ["r", "s", "th", "x", "z", "n", "l", "re", "is", "us", "oth", "yx"],
        codaChance: 0.65,
        medials: ["nos", "sang", "vel", "mor", "car", "lac", "umbr", "noir", "vlad", "rav", "dusk"],
        medialMorphChance: 0.45,
        suffixes: ["ius", "elle", "oire", "an", "ar", "or", "yx", "ath", "osa"],
    },
    [Language.DERPTONGUE]: {
        onsets: ["b", "g", "k", "p", "d", "t", "f", "m", "n", "r", "s", "bl", "gr", "kr", "sn", "pl", "fl", "z", "v"],
        vowels: ["a", "e", "i", "o", "u", "oo", "ee", "uh", "ah", "ow"],
        codas: ["", "g", "k", "p", "t", "n", "m", "b", "sh", "zz", "rp", "nk"],
        codaChance: 0.6,
        medials: ["derp", "blor", "snar", "plop", "gorp", "flub", "drool", "bonk", "boop"],
        medialMorphChance: 0.55,
        suffixes: ["er", "us", "o", "ee", "oo", "ah", "uh", "boop", "onk"],
    },
    [Language.TOADISH]: {
        onsets: ["gr", "kr", "br", "cro", "fro", "gl", "pl", "r", "bl", "cr", "tr", "dr"],
        vowels: ["o", "u", "oo", "oa", "ou", "uh", "a", "ua"],
        codas: ["g", "k", "rk", "rg", "mp", "b", "bb", "gk", "nk", "rr", "p"],
        codaChance: 0.75,
        medials: ["croa", "rib", "grub", "glo", "slop", "murk", "drib", "blob"],
        medialMorphChance: 0.45,
        suffixes: ["og", "ug", "ump", "ok", "ogg", "onk", "croak"],
    },
    [Language.BANANAIC]: {
        // lots of open syllables; some empty onset for pure-vowel starts
        onsets: ["", "b", "d", "g", "k", "m", "n", "p", "t", "w", "h", "ba", "na", "ma", "pa", "ga", "da"],
        vowels: ["a", "e", "i", "o", "u", "aa", "ee", "oo", "ai", "au"],
        codas: ["", "na", "ma", "pa", "ba", "ga", "ka", "la", "ha"],
        codaChance: 0.6,
        medials: ["na", "nana", "mama", "papa", "gaga", "lala", "haha", "wawa", "baba", "dada"],
        medialMorphChance: 0.6,
        suffixes: ["na", "nana", "banana", "mana", "pana", "bana", "lala", "haha"],
    },
    [Language.LYRICIAN]: {
        onsets: [
            "a", "e", "i", "o", "u",
            "l", "n", "m", "r", "s", "v", "f", "h", "y",
            "al", "el", "il", "ol", "ul", "ar", "en", "ir", "or", "ur", "ly", "ny", "th", "ph"
        ],
        vowels: ["a", "e", "i", "o", "u", "ai", "ei", "ia", "io", "oa", "ue", "ui"],
        codas: ["l", "n", "r", "s", "th", "m", "el", "en", "ir", "is", "ar", "al"],
        codaChance: 0.45,
        medials: [
            "ara", "eli", "ian", "ora", "ina", "ira", "ala", "esi", "len", "mir", "var", "ser", "vel", "lin"
        ],
        medialMorphChance: 0.35,
        suffixes: ["iel", "is", "en", "el", "ora", "ine", "ar", "eth", "iel", "ane"],
    },
    [Language.ANGLISHIC]: {
        onsets: [
            "b", "br", "bl", "c", "cl", "cr", "d", "dr", "f", "fl", "fr", "g", "gr", "gl", "h", "j", "k", "kr",
            "l", "m", "n", "p", "pl", "pr", "r", "s", "sl", "sm", "sn", "sp", "st", "sw", "t", "tr", "v", "w", "wh"
        ],
        vowels: ["a", "e", "i", "o", "u", "ai", "ea", "ie", "oa", "oo", "ou", "uh", "ar", "er"],
        codas: [
            "b", "d", "f", "g", "k", "l", "m", "n", "p", "r", "s", "t",
            "ck", "nd", "nt", "st", "sp", "sh", "th", "rd", "rk", "rm", "rl", "lp", "ft"
        ],
        codaChance: 0.6,
        medials: [
            "ing", "ish", "est", "ard", "orn", "all", "and", "ell", "ock", "ump", "old", "ent",
            "ram", "win", "ber", "ble", "trum", "croft", "shire", "worth"
        ],
        medialMorphChance: 0.4,
        suffixes: [
            "ton", "ham", "worth", "wick", "well", "ford", "croft", "den", "fell", "bury", "brook", "mere", "stead"
        ],
    },
    [Language.NEW_ANGLISHIC]: {
        onsets: [
            "a", "b", "br", "c", "cl", "cr", "d", "f", "fl", "fr", "g", "gl", "gr", "h", "j", "k", "kr",
            "l", "m", "n", "p", "pl", "pr", "r", "s", "sl", "sm", "sp", "st", "t", "tr", "v", "w",
            "well", "brook", "grove", "nex", "ever", "fair", "north", "east", "west", "green", "bright", "clear", "sil", "blue", "gold"
        ],
        vowels: ["a", "e", "i", "o", "u", "ai", "ea", "ie", "oa", "ou", "ar", "er", "or"],
        codas: [
            "n", "r", "s", "t", "m", "l", "d", "k", "x", "nd", "nt", "rd", "rn", "st", "ft", "den", "ton", "ford", "ly"
        ],
        codaChance: 0.5,
        medials: [
            "well", "brook", "vale", "fold", "ridge", "moor", "bank", "port", "field", "mill",
            "crest", "grove", "point", "gate", "worth", "ford", "haven", "side", "wick", "holt", "mark"
        ],
        medialMorphChance: 0.4,
        suffixes: [
            "well", "fold", "worth", "ridge", "vale", "hill", "gate", "point", "mill", "brook",
            "haven", "croft", "grove", "port", "ly", "ton", "den", "sy", "corp", "soft", "tek"
        ],
    },

}