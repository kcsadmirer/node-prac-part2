const User = require('../models/user');

const { validationResult } = require('express-validator');
const crypto = require('crypto');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const sendgridTransport = require('nodemailer-sendgrid-transport');

const transporter = nodemailer.createTransport(sendgridTransport({
    auth: {
        api_key: 'key'
    }
}));

exports.getLogin = (req, res, next) => {
    console.log(req.session.isLoggedIn);
    res.render('auth/login', {
        path: '/login',
        pageTitle: 'Login',
        isAuthenticated: false,
        errorMsg: null,
        oldData: {
            email: '',
            password: ''
        }
    });
};

exports.getSignup = (req, res, next) => {
    res.render('auth/signup', {
        path: '/signup',
        pageTitle: 'Signup',
        isAuthenticated: false,
        errorMsg: null,
        oldData: {
            email: '',
            password: '',
            confirmPassword: ''
        },
        validationErrors: []
    });
}

exports.postLogin = (req, res, next) => {
    const { email, password } = req.body;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        console.log(errors.array());
        return res.status(422).render('auth/login', {
            path: '/login',
            pageTitle: 'Login',
            isAuthenticated: false,
            errorMsg: errors.array()?.[0].msg,
            oldData: {
                email: email,
                password: password
            }
        });
    }
    User.findOne({
        where: {
            email: {
                [Op.eq]: email
            }
        }
    }).then(user => {
        bcrypt.compare(password, user.password).then(matched => {
            if (matched) {
                req.session.isLoggedIn = true;
                req.session.userId = user.id;
                req.session.save(err => { // doing this is very important !!! otherwise the response would be given before the session is set as setting session is Async! and takes few milliseconds!
                    console.log(err);
                    res.redirect('/');
                });
            } else { //invalid password!
                return res.status(422).render('auth/login', {
                    path: '/login',
                    pageTitle: 'Login',
                    isAuthenticated: false,
                    errorMsg: 'Invalid Password !',
                    oldData: {
                        email: '',
                        password: ''
                    }
                });
            }
        }).catch(err => {
            console.log(err);
            res.redirect('/login');
        });
    }).catch(err => console.log(err));
};

exports.postSignup = (req, res, next) => {
    const { email, password, confirmPassword } = req.body;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        console.log(errors.array());
        return res.status(422).render('auth/signup', {
            path: '/signup',
            pageTitle: 'Signup',
            errorMsg: errors.array()?.[0].msg,
            oldData: {
                email: email,
                password: password,
                confirmPassword: confirmPassword
            },
            validationErrors: errors.array()
        });
    }
    bcrypt.hash(password, 12).then(hashPassword => {
        return User.create({
            email: email,
            password: hashPassword
        });
    }).then(user => {
        return user.createCart();
    }).then(cart => {
        res.redirect('/login');
        return transporter.sendMail({ //the promise is returned to the next then block with its result!
            to: email,
            from: 'sender',
            subject: 'Successfully Signed up!',
            html: '<h1>You have successfully signed up for the Online shop!</h1>'
        });
    }).then(result => console.log('Mail sent successfully!'))
        .catch(err => console.log(err));
};

exports.postLogout = (req, res, next) => {
    req.session.destroy(err => {
        console.log(err);
        res.redirect('/');
    });
};

exports.getReset = (req, res, next) => {
    res.render('auth/reset', {
        path: '/reset',
        pageTitle: 'Reset Password'
    });
};

exports.postReset = (req, res, next) => {
    crypto.randomBytes(32, (err, buffer) => {
        if (err) {
            return res.redirect('/reset');
        }
        const token = buffer.toString('hex');
        User.findOne({
            where: {
                email: {
                    [Op.eq]: req.body.email
                }
            }
        }).then(user => {
            if (!user) {
                return res.status(422).render('auth/login', {
                    path: '/login',
                    pageTitle: 'Login',
                    isAuthenticated: false,
                    errorMsg: 'No such user with the given email! Please re-fill the reset form !',
                    oldData: {
                        email: '',
                        password: ''
                    }
                });
            }
            user.resetToken = token;
            user.resetTokenExpiration = Date.now() + 15 * 60 * 1000;
            return user.save();
        }).then(user => {
            res.redirect('/');
            return transporter.sendMail({
                to: req.body.email,
                from: 'sender',
                subject: 'Reset Password',
                html: `
                    <p>Click this <a href="http://localhost:3000/reset/${token}">link</a> to set reset password!</p>
                `
            });
        }).then(x => console.log('Mail sent succesfully!')).catch(err => console.log(err));
    });
};

exports.getNewPassword = (req, res, next) => {
    const token = req.params.token;
    User.findOne({
        where: {
            [Op.and]: [
                {
                    resetToken: {
                        [Op.eq]: token
                    }
                },
                {
                    resetTokenExpiration: {
                        [Op.gt]: Date.now()
                    }
                }
            ]
        }
    }).then(user => {
        if (!user) {
            return res.status(422).render('auth/login', {
                path: '/login',
                pageTitle: 'Login',
                isAuthenticated: false,
                errorMsg: "There's no such user ! please try again !",
                oldData: {
                    email: '',
                    password: ''
                }
            });
        }
        res.render('auth/newPassword', {
            path: '/new-password',
            pageTitle: 'Reset Password',
            userId: user.id,
            passwordToken: token
        });
    }).catch(err => console.log(err));
};

exports.postNewPassword = (req, res, next) => {
    const { password: newPassword, userId, passwordToken } = req.body;
    User.findOne({
        where: {
            [Op.and]: [
                {
                    resetToken: {
                        [Op.eq]: passwordToken
                    }
                },
                {
                    resetTokenExpiration: {
                        [Op.gt]: Date.now()
                    }
                },
                {
                    id: {
                        [Op.eq]: userId
                    }
                }
            ]
        }
    }).then(user => {
        if (!user) {
            return res.status(422).render('auth/login', {
                path: '/login',
                pageTitle: 'Login',
                isAuthenticated: false,
                errorMsg: 'There was an error ! Please try again !',
                oldData: {
                    email: '',
                    password: ''
                }
            });
        }
        bcrypt.hash(newPassword, 12).then(hashPassword => {
            user.password = hashPassword;
            user.resetToken = null;
            user.resetTokenExpiration = null;
            return user.save();
        }).then(result => {
            res.redirect('/login');
            return transporter.sendMail({
                to: user.email,
                from: 'sender',
                subject: 'Password reset successfully',
                html: `<h1>Your password for the Onlineshop account has been successfully reset to ${newPassword}!</h1>`
            });
        }).then(msg => console.log('Successfully Resetted password!')).catch(err => console.log(err));
    }).catch(err => console.log(err));
};