// Funciton to send the reponses in a structured way
function ApiReponse(res, statusCode, message, data) {
    
    return res.status(statusCode).json({
        success: true,
        message,
        data
    })

}

export default ApiReponse;