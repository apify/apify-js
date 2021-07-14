const Apify = require('./build');
const {sleep} = Apify.utils;

const html = `
<html>
<head>
    <style type="text/css">
        div {
            display: flex;
            flex-direction: column;
            width: 10%
        }
    </style>
</head>
<body>
<div name="signup">
    search
    <input type="search" name="search" id="search" class="" placeholder="search">
    <input type="date" name="" id="searchDate" class="">
    <label><input type="checkbox" name="search" id="searchCheck" class="">include stuff</label>
    <button type="submit">OK</button>
</div>

<div name="signup">
    signup
    <input type="text" name="user" id="signup1" class="user" placeholder="user">
    <input type="text" name="name" id="signup2" class="" placeholder="name">
    <input type="email" name="email" id="signup3" class="email" placeholder="email">
    <input type="password" name="" id="signup4" class="" placeholder="password1">
    <input type="password" name="" id="signup5" class="" placeholder="password2">
    <label><input type="checkbox" name="search" id="signupCheck1" class="">agree</label>
    <label><input type="checkbox" name="search" id="signupCheck2" class="">to</label>
    <label><input type="checkbox" name="search" id="signupCheck3" class="">disagree</label>
    <button type="submit">OK</button>
</div>

<div name="reset">
    reset
    <input type="text" name="username" id="reset1" class="username" placeholder="username">
    <input type="password" name="old" id="reset2" class="" placeholder="password old">
    <input type="password" name="new1" id="reset3" class="" placeholder="password new">
    <input type="password" name="retype" id="reset4" class="" placeholder="password new again">
    <button type="submit">OK</button>
</div>

<div name="feedback">
    feedback
    <input type="text" name="name" id="feedback1" class="username" placeholder="name">
    <input type="email" name="email" id="feedback2" class="email" placeholder="email">
    <input type="text" name="" id="feedback3" class="" placeholder="text">
    <input type="file" name="" id="feedbackFile" class="">
    <button type="submit">OK</button>
</div>

<div name="login">
    login
    <input type="text" name="u" id="u" class="one user two" placeholder="username">
    <input type="password" name="p" id="p" class="" placeholder="password">
    <button type="submit">OK</button>
</div>
</body>
</html>
`;

Apify.main(async () => {

    const browser = await Apify.launchPuppeteer();
    const page = await browser.newPage();
    await page.setContent(html);


    await Apify.utils.login(page);
    await sleep(9999);

});
